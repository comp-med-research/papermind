import os
import json
from openai import OpenAI
from anthropic import Anthropic
from dotenv import load_dotenv

load_dotenv()

# ─────────────────────────────────────────────
# CLIENTS
# ─────────────────────────────────────────────

# Nemotron via Brev — uses OpenAI-compatible API
nemotron = OpenAI(
    api_key=os.getenv("NEMOTRON_API_KEY"),
    base_url=os.getenv("NEMOTRON_BASE_URL")  # Brev gives you this URL
)

# Claude as the synthesis/quality judge
claude = Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))

# ─────────────────────────────────────────────
# STATE — this is the "memory" of the session
# ─────────────────────────────────────────────

class SessionState:
    def __init__(self, sentences: list[str]):
        self.sentences = sentences          # all sentences in the paper
        self.position = 0                   # which sentence we're on
        self.status = "IDLE"               # IDLE, READING, INTERRUPTED, ANSWERING, RESUMING
        self.questions_asked = []          # full history of questions + answers
        self.concepts_explained = []       # what concepts have been explained
        self.knowledge_gaps = []           # recurring topics user struggles with

    def current_sentence(self):
        if self.position < len(self.sentences):
            return self.sentences[self.position]
        return None

    def surrounding_context(self, window=5):
        # gives agents a window of sentences around current position for context
        start = max(0, self.position - window)
        end = min(len(self.sentences), self.position + window)
        return " ".join(self.sentences[start:end])

    def advance(self):
        self.position += 1

    def to_dict(self):
        return {
            "position": self.position,
            "status": self.status,
            "questions_asked": self.questions_asked[-5:],  # last 5 only
            "concepts_explained": self.concepts_explained,
            "knowledge_gaps": self.knowledge_gaps
        }


# ─────────────────────────────────────────────
# AGENT 1: ORCHESTRATOR
# Decides what to do next based on state
# ─────────────────────────────────────────────

def orchestrator_agent(state: SessionState, user_action: str) -> dict:
    """
    The brain. Takes the current state + what the user just did,
    returns a decision about what should happen next.

    user_action: "START", "INTERRUPT", "RESUME", "QUESTION: <text>"
    returns: { "action": "READ" | "ANSWER" | "RESUME" | "FLAG_CONCEPT", "reason": str }
    """

    system_prompt = """You are the Orchestrator of a reading assistant for people with ADHD.
Your job is to manage reading state and decide what action to take next.
You must respond with ONLY valid JSON — no explanation, no markdown.

Current states:
- READ: continue reading the next sentence
- ANSWER: user has interrupted with a question, activate conversation agent  
- RESUME: user wants to continue reading after an interruption
- FLAG_CONCEPT: proactively pause because upcoming text contains jargon the user has struggled with before

Rules:
- Never lose the reading position
- If user has asked about a concept before, note it
- Protect the reading thread above all else
- Be proactive: if you see a concept in knowledge_gaps appearing ahead, FLAG_CONCEPT before reading it"""

    user_prompt = f"""
Current session state:
{json.dumps(state.to_dict(), indent=2)}

Current sentence: "{state.current_sentence()}"

User action: {user_action}

What should happen next? Respond with JSON like:
{{"action": "READ", "reason": "User wants to continue, no obstacles ahead"}}
or
{{"action": "FLAG_CONCEPT", "concept": "p-value", "reason": "User has asked about p-values twice before and this sentence contains one"}}
"""

    response = nemotron.chat.completions.create(
        model=os.getenv("NEMOTRON_MODEL", "nvidia/nemotron-3-nano"),
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt}
        ],
        max_tokens=200,
        temperature=0.1  # low temp — we want consistent decisions not creativity
    )

    raw = response.choices[0].message.content.strip()
    # strip markdown code fences if present
    raw = raw.replace("```json", "").replace("```", "").strip()

    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        # fallback if Nemotron returns something unexpected
        return {"action": "READ", "reason": "fallback"}


# ─────────────────────────────────────────────
# AGENT 2: CONVERSATION AGENT
# Handles interruptions and questions
# ─────────────────────────────────────────────

def conversation_agent(question: str, state: SessionState, full_text: str) -> dict:
    """
    Answers the user's question using:
    1. RAG over the document (surrounding context)
    2. General knowledge from Nemotron
    Returns answer + a suggested visual prompt for Runware
    """

    system_prompt = """You are a patient, brilliant tutor helping a researcher with ADHD understand a scientific paper.

Rules:
- Answer in plain, conversational English — no jargon unless you immediately explain it
- Keep answers SHORT — 3 sentences maximum for simple concepts, 5 for complex ones
- Always ground your answer in the document context provided
- After your answer, cite the specific parts of the document you used by writing: SOURCES: [quote the exact relevant phrases from the document, separated by " | "]
- End with: "Ready to continue?"
- Finally, write: VISUAL: [a short description of a diagram that would help explain this concept visually, suitable for image generation]

The user has ADHD. Clarity and brevity are kindness."""

    # simple RAG: find the most relevant sentences from the document
    context = state.surrounding_context(window=10)

    # also include any previous questions for continuity
    history = ""
    if state.questions_asked:
        last = state.questions_asked[-3:]  # last 3 Q&As
        history = "\n".join([f"Q: {q['question']}\nA: {q['answer']}" for q in last])

    user_prompt = f"""
The user is reading this paper. Here is the context around where they stopped:

DOCUMENT CONTEXT:
{context}

PREVIOUS QUESTIONS THIS SESSION:
{history if history else "None yet"}

USER'S QUESTION: {question}

Answer the question, grounded in the document. Then provide the VISUAL prompt.
"""

    response = nemotron.chat.completions.create(
        model=os.getenv("NEMOTRON_MODEL", "nvidia/llama-3.3-nemotron-super-49b-v1"),
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt}
        ],
        max_tokens=400,
        temperature=0.4
    )

    raw = response.choices[0].message.content.strip()

    # Parse answer, sources, and visual prompt
    answer = raw
    visual_prompt = None
    sources = []

    # Extract sources
    if "SOURCES:" in raw:
        parts = raw.split("SOURCES:")
        answer = parts[0].strip()
        remainder = parts[1]
        
        # Check if there's a VISUAL after SOURCES
        if "VISUAL:" in remainder:
            source_parts = remainder.split("VISUAL:")
            sources_text = source_parts[0].strip()
            visual_prompt = source_parts[1].strip()
        else:
            sources_text = remainder.strip()
        
        # Parse sources (separated by |)
        sources = [s.strip() for s in sources_text.split("|") if s.strip()]
    elif "VISUAL:" in raw:
        # No sources, but has visual
        parts = raw.split("VISUAL:")
        answer = parts[0].strip()
        visual_prompt = parts[1].strip()

    # log to state
    state.questions_asked.append({
        "question": question,
        "answer": answer,
        "position": state.position,
        "sources": sources
    })

    # update knowledge gaps using Claude as the judge
    gap = claude_judge_knowledge_gap(question, state)
    if gap and gap not in state.knowledge_gaps:
        state.knowledge_gaps.append(gap)

    return {
        "answer": answer,
        "visual_prompt": visual_prompt,
        "sources": sources,
        "reading_position": state.position  # so frontend knows exactly where to resume
    }


# ─────────────────────────────────────────────
# AGENT 3: MEMORY AGENT
# Claude judges what to remember long-term
# ─────────────────────────────────────────────

def claude_judge_knowledge_gap(question: str, state: SessionState) -> str | None:
    """
    Uses Claude to decide if this question reveals a recurring knowledge gap
    worth remembering for future sessions.
    Returns a short concept label or None.
    """

    # only check if user has asked 2+ questions
    if len(state.questions_asked) < 2:
        return None

    recent_questions = [q["question"] for q in state.questions_asked[-5:]]

    response = claude.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=100,
        system="""You identify recurring knowledge gaps from a user's questions.
If the questions reveal a pattern — a concept type the user consistently struggles with — 
return ONLY a short label like "statistical terminology" or "molecular biology basics".
If there's no clear pattern yet, return ONLY the word: NONE""",
        messages=[{
            "role": "user",
            "content": f"Recent questions: {json.dumps(recent_questions)}\nNew question: {question}"
        }]
    )

    result = response.content[0].text.strip()
    return None if result == "NONE" else result


# ─────────────────────────────────────────────
# AGENT 4: READING AGENT
# Prepares each sentence for TTS
# ─────────────────────────────────────────────

def reading_agent(state: SessionState) -> dict:
    """
    Gets the next sentence to read.
    Checks with orchestrator if any proactive flags needed first.
    Returns the sentence + whether to pause before reading.
    """

    sentence = state.current_sentence()

    if not sentence:
        return {"done": True}

    # check if orchestrator wants to flag anything
    decision = orchestrator_agent(state, "START")

    if decision.get("action") == "FLAG_CONCEPT":
        concept = decision.get("concept", "")
        return {
            "sentence": sentence,
            "proactive_flag": True,
            "flag_message": f"Heads up — this next section mentions {concept}, which you've asked about before. Want a quick refresher first?",
            "done": False
        }

    state.advance()
    state.status = "READING"

    return {
        "sentence": sentence,
        "proactive_flag": False,
        "done": False
    }


# ─────────────────────────────────────────────
# MAIN ORCHESTRATION LOOP
# This is what your FastAPI endpoints call
# ─────────────────────────────────────────────

def handle_start(state: SessionState) -> dict:
    """Call this when user hits Play"""
    state.status = "READING"
    return reading_agent(state)


def handle_interrupt(question: str, state: SessionState, full_text: str) -> dict:
    """Call this when user hits the Interrupt button"""
    state.status = "INTERRUPTED"
    result = conversation_agent(question, state, full_text)
    state.status = "ANSWERING"
    return result


def handle_resume(state: SessionState) -> dict:
    """Call this when user says 'continue' or taps resume"""
    state.status = "RESUMING"
    return reading_agent(state)


def get_session_summary(state: SessionState) -> dict:
    """Returns what the memory panel shows"""
    return {
        "questions_asked": len(state.questions_asked),
        "knowledge_gaps": state.knowledge_gaps,
        "concepts_explained": state.concepts_explained,
        "progress": f"{state.position}/{len(state.sentences)} sentences",
        "percent": round((state.position / max(len(state.sentences), 1)) * 100)
    }