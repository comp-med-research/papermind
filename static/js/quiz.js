/**
 * Renders an interactive multiple-choice quiz inside the chat panel.
 * Questions appear one at a time. After answering all, a summary is shown.
 */

export function renderQuizInChat(questions) {
    if (!questions || questions.length === 0) return;

    const messagesContainer = document.getElementById('chatMessages');
    if (!messagesContainer) return;

    const quizWrapper = document.createElement('div');
    quizWrapper.className = 'chat-message assistant-message quiz-message';

    const avatar = document.createElement('div');
    avatar.className = 'message-avatar ai-avatar';
    avatar.textContent = '🧠';

    const content = document.createElement('div');
    content.className = 'message-content';

    const quizCard = document.createElement('div');
    quizCard.className = 'quiz-card';

    let currentIndex = 0;
    let score = 0;
    const answered = new Array(questions.length).fill(false);

    function renderQuestion(idx) {
        const q = questions[idx];
        quizCard.innerHTML = `
            <div class="quiz-header">
                <span class="quiz-progress">Question ${idx + 1} of ${questions.length}</span>
                <div class="quiz-progress-bar">
                    <div class="quiz-progress-fill" style="width: ${((idx) / questions.length) * 100}%"></div>
                </div>
            </div>
            <p class="quiz-question">${q.question}</p>
            <div class="quiz-options">
                ${q.options.map((opt, i) => `
                    <button class="quiz-option" data-index="${i}">${opt}</button>
                `).join('')}
            </div>
            <div class="quiz-feedback hidden"></div>
        `;

        quizCard.querySelectorAll('.quiz-option').forEach(btn => {
            btn.addEventListener('click', () => {
                if (answered[idx]) return;
                answered[idx] = true;

                const chosen = parseInt(btn.dataset.index);
                const correct = q.correct;
                const feedbackEl = quizCard.querySelector('.quiz-feedback');

                quizCard.querySelectorAll('.quiz-option').forEach((b, i) => {
                    b.disabled = true;
                    if (i === correct) b.classList.add('correct');
                    else if (i === chosen && chosen !== correct) b.classList.add('wrong');
                });

                if (chosen === correct) score++;

                feedbackEl.classList.remove('hidden');
                feedbackEl.className = `quiz-feedback ${chosen === correct ? 'quiz-feedback-correct' : 'quiz-feedback-wrong'}`;
                feedbackEl.innerHTML = `
                    <span>${chosen === correct ? '✅ Correct!' : '❌ Incorrect.'}</span>
                    <p>${q.explanation}</p>
                    ${idx < questions.length - 1
                        ? '<button class="quiz-next-btn">Next question →</button>'
                        : '<button class="quiz-next-btn">See results →</button>'
                    }
                `;

                feedbackEl.querySelector('.quiz-next-btn').addEventListener('click', () => {
                    currentIndex++;
                    if (currentIndex < questions.length) {
                        renderQuestion(currentIndex);
                    } else {
                        renderResults();
                    }
                    messagesContainer.scrollTop = messagesContainer.scrollHeight;
                });

                messagesContainer.scrollTop = messagesContainer.scrollHeight;
            });
        });
    }

    function renderResults() {
        const pct = Math.round((score / questions.length) * 100);
        const emoji = pct === 100 ? '🏆' : pct >= 67 ? '👍' : '📖';
        quizCard.innerHTML = `
            <div class="quiz-results">
                <div class="quiz-results-icon">${emoji}</div>
                <h3 class="quiz-results-title">Quiz Complete!</h3>
                <p class="quiz-results-score">${score} / ${questions.length} correct (${pct}%)</p>
                <p class="quiz-results-message">${
                    pct === 100 ? 'Perfect score! You nailed it.' :
                    pct >= 67 ? 'Good job! Review the ones you missed.' :
                    'Keep reading — this section is worth revisiting.'
                }</p>
                <button class="quiz-retry-btn">🔄 Retry Quiz</button>
            </div>
        `;
        quizCard.querySelector('.quiz-retry-btn').addEventListener('click', () => {
            score = 0;
            answered.fill(false);
            currentIndex = 0;
            renderQuestion(0);
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
        });
    }

    renderQuestion(0);

    content.appendChild(quizCard);
    quizWrapper.appendChild(avatar);
    quizWrapper.appendChild(content);
    messagesContainer.appendChild(quizWrapper);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}
