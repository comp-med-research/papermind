"""
RAG (Retrieval Augmented Generation) for PaperMind.
Semantic search via NVIDIA NeMo Retriever (llama-3.2-nv-embedqa-1b-v2) or sentence-transformers fallback.
"""
import os
import re
from dataclasses import dataclass


def _normalize_for_match(text: str) -> str:
    """Strip markdown, quotes, ellipsis, normalize whitespace."""
    t = text.strip()
    t = re.sub(r'\*+', '', t)
    t = re.sub(r'^["\']+|["\']+$', '', t)
    t = re.sub(r'\.{2,}$', '', t)
    t = re.sub(r'\s+', ' ', t)
    t = re.sub(r'[-–—]', ' ', t)  # Normalize hyphens/dashes for matching
    return t.lower()


@dataclass
class Chunk:
    """A chunk of document text with metadata for retrieval and citation."""
    text: str
    page: int | None
    sentence_indices: list[int]


def _find_page_for_text(text: str, page_text_map: dict[int, str]) -> int | None:
    """Find which page a text snippet appears on. Uses flexible substring matching."""
    if not text or not text.strip():
        return None
    text_clean = _normalize_for_match(text)
    for page_num, page_text in page_text_map.items():
        page_clean = re.sub(r'\s+', ' ', page_text).lower()
        page_clean = re.sub(r'[-–—]', ' ', page_clean)
        if text_clean[:80] in page_clean:
            return page_num
        if len(text_clean) > 50 and text_clean[:50] in page_clean:
            return page_num
        if len(text_clean) > 30 and text_clean[:30] in page_clean:
            return page_num
        # Try first significant phrase (before first period)
        first_phrase = text_clean.split('.')[0][:60]
        if len(first_phrase) > 20 and first_phrase in page_clean:
            return page_num
    return None


def build_chunks(
    sentences: list[str],
    page_text_map: dict[int, str],
    chunk_size: int = 4,
    overlap: int = 1,
) -> list[Chunk]:
    """
    Split sentences into overlapping chunks for RAG.
    Each chunk is chunk_size sentences, sliding by (chunk_size - overlap).
    """
    chunks = []
    for i in range(0, len(sentences), chunk_size - overlap):
        end = min(i + chunk_size, len(sentences))
        chunk_sentences = sentences[i:end]
        if not chunk_sentences:
            continue
        text = " ".join(chunk_sentences)
        page = _find_page_for_text(text, page_text_map)
        chunks.append(Chunk(
            text=text,
            page=page,
            sentence_indices=list(range(i, end)),
        ))
    return chunks


# NVIDIA embedding model from the RAG Blueprint (llama-3.2-nv-embedqa-1b-v2)
# Uses input_type: "passage" for indexing, "query" for retrieval (bi-encoder)
NV_EMBED_MODEL = "nvidia/llama-3.2-nv-embedqa-1b-v2"


def _get_embedding_client():
    """OpenAI-compatible client for NVIDIA NIM embeddings."""
    from openai import OpenAI
    base_url = os.getenv("NEMOTRON_BASE_URL", "https://integrate.api.nvidia.com/v1")
    api_key = os.getenv("NEMOTRON_API_KEY") or os.getenv("NVIDIA_API_KEY")
    if not api_key:
        raise ValueError(
            "NVIDIA embedding API requires NEMOTRON_API_KEY or NVIDIA_API_KEY. "
            "Get a key at https://build.nvidia.com"
        )
    return OpenAI(api_key=api_key, base_url=base_url.rstrip("/"))


def _embed_texts(
    client, texts: list[str], input_type: str  # "passage" or "query"
) -> list[list[float]]:
    """Call NVIDIA embedding API. Requires input_type for bi-encoder accuracy."""
    if not texts:
        return []
    # NVIDIA nv-embedqa models require input_type (passage vs query)
    result = client.embeddings.create(
        model=NV_EMBED_MODEL,
        input=texts,
        extra_body={"input_type": input_type},
    )
    return [item.embedding for item in result.data]


class DocumentRAG:
    """
    Semantic retrieval over a single document.
    Uses NVIDIA NeMo Retriever (llama-3.2-nv-embedqa-1b-v2) via NIM API.
    Falls back to sentence-transformers if NVIDIA model isn't available.
    """

    def __init__(self):
        self._client = None
        self._fallback_model = None  # sentence-transformers when NVIDIA 404
        self._chunks: list[Chunk] = []
        self._embeddings = None  # shape: (n_chunks, dim)
        self._use_nvidia = True  # False if we fell back

    def _get_client(self):
        if self._client is None:
            self._client = _get_embedding_client()
        return self._client

    def _get_fallback_model(self):
        if self._fallback_model is None:
            try:
                from sentence_transformers import SentenceTransformer
                self._fallback_model = SentenceTransformer("all-MiniLM-L6-v2")
            except ImportError:
                raise ImportError(
                    "NVIDIA embedding failed. Install sentence-transformers for fallback: "
                    "pip install sentence-transformers"
                )
        return self._fallback_model

    def index(
        self,
        sentences: list[str],
        page_text_map: dict[int, str],
    ) -> None:
        """Build the RAG index from document sentences."""
        self._chunks = build_chunks(sentences, page_text_map)
        if not self._chunks:
            self._embeddings = None
            return

        texts = [c.text for c in self._chunks]
        try:
            client = self._get_client()
            self._embeddings = _embed_texts(client, texts, "passage")
            self._use_nvidia = True
        except Exception as e:
            if "404" in str(e) or "NotFound" in str(type(e).__name__):
                print(
                    f"NVIDIA embedding model not available ({e}). "
                    "Using sentence-transformers fallback. "
                    "Enable llama-3.2-nv-embedqa-1b-v2 at build.nvidia.com for NVIDIA RAG."
                )
            else:
                print(f"NVIDIA embedding failed: {e}. Using sentence-transformers fallback.")
            self._use_nvidia = False
            model = self._get_fallback_model()
            self._embeddings = model.encode(texts, show_progress_bar=False)

    def retrieve(
        self,
        query: str,
        top_k: int = 5,
    ) -> list[tuple[str, int | None]]:
        """
        Retrieve the most relevant chunks for a query via semantic similarity.
        Returns list of (chunk_text, page_num).
        """
        if not self._chunks or self._embeddings is None:
            return []

        import numpy as np

        if self._use_nvidia:
            client = self._get_client()
            query_embs = _embed_texts(client, [query], "query")
        else:
            model = self._get_fallback_model()
            query_embs = [model.encode([query], show_progress_bar=False)[0].tolist()]
        if not query_embs:
            return []
        query_emb = np.array(query_embs[0])
        embeddings = np.array(self._embeddings, dtype=np.float32)
        norms = np.linalg.norm(embeddings, axis=1, keepdims=True)
        norms = np.where(norms == 0, 1, norms)
        normalized = embeddings / norms
        q_norm = np.linalg.norm(query_emb)
        if q_norm == 0:
            return []
        scores = np.dot(normalized, query_emb / q_norm)
        top_indices = np.argsort(scores)[::-1][:top_k]

        return [
            (self._chunks[i].text, self._chunks[i].page)
            for i in top_indices
        ]

    def get_embedding_backend(self) -> str:
        """Returns 'nvidia' or 'sentence-transformers' based on which pathway was used."""
        return "nvidia" if self._use_nvidia else "sentence-transformers"
