import { GoogleGenAI, GenerateContentResponse } from "@google/genai";

const recordButton = document.getElementById('recordButton') as HTMLButtonElement;
const statusDisplay = document.getElementById('status') as HTMLParagraphElement;
const resultsContainer = document.getElementById('resultsContainer') as HTMLElement;
const transcriptionSection = document.getElementById('transcriptionSection') as HTMLElement;
const transcriptionOutput = document.getElementById('transcriptionOutput') as HTMLPreElement;
const summarySection = document.getElementById('summarySection') as HTMLElement;
const summaryOutput = document.getElementById('summaryOutput') as HTMLPreElement;

let ai: GoogleGenAI | null = null;
let mediaRecorder: MediaRecorder | null = null;
let audioChunks: Blob[] = [];
let isRecording = false;

// Initialize GoogleGenerativeAI
try {
    if (!process.env.API_KEY) {
        throw new Error("API_KEY environment variable not set.");
    }
    ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
} catch (error) {
    console.error("Failed to initialize GoogleGenAI:", error);
    updateStatus("Error: API Key not configured. Please set API_KEY.", true);
    if (recordButton) recordButton.disabled = true;
}

const SYSTEM_INSTRUCTION_FOR_ANALYSIS = `You are an AI assistant processing daily audio journals ('Morning Pages') for a user named John. Your task is to generate a detailed, structured summary based on the provided transcription.

Contextual Information: Be aware of these entities:
    * User: John
    * Wife: Ruth
    * Children: Aedan, Artemis
    * Companies: Aigora, Tulle (Note: 'Tulle' the company sounds like the common word 'tool'. Use the surrounding context to determine if John is referring to the company or the word. If it's likely the company, use 'Tulle').

Summary Structure and Content:
    * Date Header: Start the summary with the current date as a Level 1 Markdown header. Use today's date: March 30, 2025 (Format: # YYYY-MM-DD).
    * Mood Analysis: Analyze the content, word choice, and phrasing in the transcription to infer John's likely mood or emotional state (e.g., optimistic, stressed, reflective, frustrated). Include a brief section like: **Mood Analysis:** [Your assessment of John's mood based on the text].
    * Insights: Identify any reflections, ideas, or observations that seem particularly interesting or novel. List these under a section: **Insights:**\\n- [Insight 1]\\n- [Insight 2]. If none are apparent, state "No specific insights noted."
    * Important Items: Identify anything John explicitly states is important, critical, a priority, or needs immediate attention. List these clearly under a section: **Important Items:**\\n- [Important Item 1]\\n- [Important Item 2]. If none are mentioned, state "No specific important items highlighted."
    * General Summary: Provide a concise paragraph summarizing the main topics John discussed (e.g., plans for the day, thoughts about Aigora or Tulle, family mentions, challenges, ideas).

Output only the Markdown Summary based on the transcription provided by the user.
The Markdown Summary should look like this:
\`\`\`markdown
# 2025-03-30

**Mood Analysis:**
[Inferred mood based on text]

**Insights:**
- [Insight 1, if any]
- [Insight 2, if any]
(or "No specific insights noted.")

**Important Items:**
- [Important Item 1, if any]
- [Important Item 2, if any]
(or "No specific important items highlighted.")

**General Summary:**
[Concise summary paragraph of topics discussed]
\`\`\`
`;


function updateStatus(message: string, isError: boolean = false) {
    if (statusDisplay) {
        statusDisplay.textContent = message;
        statusDisplay.style.color = isError ? '#d32f2f' : '#555';
    }
    console.log(message);
}

function blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
            if (typeof reader.result === 'string') {
                resolve(reader.result.split(',')[1]);
            } else {
                reject(new Error("Failed to read blob as base64 string."));
            }
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

async function startRecording() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        updateStatus("getUserMedia not supported on your browser!", true);
        return;
    }
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' }); // Common MIME type
        audioChunks = [];

        mediaRecorder.ondataavailable = event => {
            audioChunks.push(event.data);
        };

        mediaRecorder.onstop = async () => {
            const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
            audioChunks = []; // Clear for next recording
            stream.getTracks().forEach(track => track.stop()); // Stop microphone access

            if (audioBlob.size === 0) {
                updateStatus("No audio recorded. Please try again.", true);
                recordButton.disabled = false;
                return;
            }
            
            updateStatus("Processing audio...");
            try {
                const base64Audio = await blobToBase64(audioBlob);
                await transcribeAndAnalyze(base64Audio);
            } catch (error) {
                console.error("Error processing audio:", error);
                updateStatus(`Error processing audio: ${error instanceof Error ? error.message : String(error)}`, true);
                recordButton.disabled = false;
            }
        };

        mediaRecorder.start();
        isRecording = true;
        recordButton.textContent = 'Stop Recording';
        recordButton.classList.add('recording');
        recordButton.setAttribute('aria-label', 'Stop recording');
        updateStatus('Recording...');
        resultsContainer.classList.add('hidden'); // Hide previous results
        transcriptionSection.classList.add('hidden');
        summarySection.classList.add('hidden');

    } catch (err) {
        console.error("Error accessing microphone:", err);
        updateStatus(`Error accessing microphone: ${err instanceof Error ? err.message : String(err)}. Please ensure permission is granted.`, true);
        recordButton.disabled = false; // Re-enable button if recording setup failed
    }
}

function stopRecording() {
    if (mediaRecorder && isRecording) {
        mediaRecorder.stop();
        isRecording = false;
        recordButton.textContent = 'Record';
        recordButton.classList.remove('recording');
        recordButton.setAttribute('aria-label', 'Start recording');
        recordButton.disabled = true; // Disable until processing is complete
        updateStatus('Stopping recording...');
    }
}

async function transcribeAndAnalyze(base64Audio: string) {
    if (!ai) {
        updateStatus("AI client not initialized.", true);
        recordButton.disabled = false;
        return;
    }

    updateStatus('Transcribing audio...');
    transcriptionOutput.textContent = '';
    summaryOutput.textContent = '';


    try {
        // 1. Transcribe Audio
        const audioPart = {
            inlineData: {
                mimeType: 'audio/webm',
                data: base64Audio,
            },
        };
        const textPart = {
            text: "Transcribe this audio. The speaker is John. Do not include timestamps.",
        };

        const transcriptionResponse: GenerateContentResponse = await ai.models.generateContent({
            model: 'gemini-2.5-flash-preview-04-17', // multimodal model
            contents: { parts: [audioPart, textPart] },
        });
        
        const transcription = transcriptionResponse.text;
        if (!transcription || transcription.trim() === "") {
          updateStatus("Transcription failed or returned empty. Nothing to analyze.", true);
          transcriptionOutput.textContent = "[No transcription available]";
          resultsContainer.classList.remove('hidden');
          transcriptionSection.classList.remove('hidden');
          recordButton.disabled = false;
          return;
        }

        transcriptionOutput.textContent = transcription;
        transcriptionSection.classList.remove('hidden');
        resultsContainer.classList.remove('hidden');

        // 2. Analyze Transcription
        updateStatus('Analyzing journal...');
        const analysisResponse: GenerateContentResponse = await ai.models.generateContent({
            model: 'gemini-2.5-flash-preview-04-17',
            contents: transcription, // User content is the transcription
            config: {
                systemInstruction: SYSTEM_INSTRUCTION_FOR_ANALYSIS,
            }
        });

        const summary = analysisResponse.text;
        summaryOutput.textContent = summary;
        summarySection.classList.remove('hidden');

        updateStatus('Done.');

    } catch (error) {
        console.error('Error during AI processing:', error);
        updateStatus(`Error during AI processing: ${error instanceof Error ? error.message : String(error)}`, true);
        resultsContainer.classList.remove('hidden'); // Show whatever results might exist or error placeholders
         if (!transcriptionOutput.textContent) {
            transcriptionOutput.textContent = "[Transcription failed]";
            transcriptionSection.classList.remove('hidden');
        }
        if (!summaryOutput.textContent) {
            summaryOutput.textContent = "[Analysis failed]";
            summarySection.classList.remove('hidden');
        }
    } finally {
        recordButton.disabled = false;
    }
}


if (recordButton) {
    recordButton.addEventListener('click', () => {
        if (!ai) { // Double check AI client, in case of earlier init error
             updateStatus("Error: AI Client not initialized. Cannot record.", true);
             return;
        }
        if (isRecording) {
            stopRecording();
        } else {
            startRecording();
        }
    });
} else {
    console.error("Record button not found.");
    updateStatus("Error: UI elements missing.", true);
}

// Initial check for API key presence (though constructor handles it)
if (!process.env.API_KEY && statusDisplay && recordButton) {
    updateStatus("Warning: API_KEY is not set. The application will not function correctly.", true);
    recordButton.disabled = true;
}
