# 🚪🏃🏽 Skipper

**for when you finally realize school doesn't teach jack\*\*\*\*.**

![Skipper Logo](/assets/logo/skipper_logo_V2_shorter.jpg)

---

![Python](https://img.shields.io/badge/Python-3776AB?style=for-the-badge&logo=python&logoColor=white)
[![Ollama](https://img.shields.io/badge/Ollama-fff?style=for-the-badge&logo=ollama&logoColor=000)](#)
[![Qwen](https://custom-icon-badges.demolab.com/badge/Qwen-605CEC?style=for-the-badge&logo=qwen&logoColor=fff)](#)
![Static Badge](https://img.shields.io/badge/twilio-red?style=for-the-badge&logo=https%3A%2F%2Fwww.svgrepo.com%2Fshow%2F354472%2Ftwilio-icon.svg&label=voice%20api)
![Static Badge](https://img.shields.io/badge/mlx_audio-orange?style=for-the-badge&label=voice%20cloning)
[![Flask](https://img.shields.io/badge/Flask-fff?style=for-the-badge&logo=flask)](#)

---

[![Prototype Demo](https://img.youtube.com/vi/gcgAY3TF3Jc/maxresdefault.jpg)](https://www.youtube.com/watch?v=gcgAY3TF3Jc)

## What and why?

School spoonfeeds. It’s not our fault that it feels like it’s not worth it. So what do we do? Skip school, which no one minds. But when those dreaded absence calls come home…

your next planned skip is in jeopardy.

What if we just called the attendance office ahead of time, notifying them of our absences? But it would have to be in our parents' voice to be real…and provide a new, convincing reason each time you are absent just on Monday and Friday of a week (don’t worry, I do that too)...and know your personal skipping schedule.

Damn, that’s a lot of elements. **Skipper takes care of all that.**

> “we've been spoon-fed baby food at school when we hungered for steak... the bits of meat that you did let slip through were pre-chewed and tasteless.” - The Hacker Manifesto

## Features

- **Google Calendar API Integration:** Automatically parses all planned absences (SKIP events) from your Google Calendar, only for the most relevant school week, allowing you to plan absences months in advance.
- **Custom Date/Logic Engine:** Employs proprietary date logic to determine the optimal school-week target. This prevents calling in highly sporadic or months-in-advance absences.
- **Local LLM Reasoning & Scripting:** Runs on-device AI models (Qwen 3.5 via Ollama) to generate highly plausible and deliberately vague absence rationales. The system enforces strict guidelines to avoid medical, accident, or specific health implications.
  - **Plausibility Matrix:** Reasons are categorized into SAFE (e.g., Family Commitment, Personal Obligation) and strictly prohibit specific illness keywords.
- **Voice Cloning (TTS):** Utilizes Blaizzy's MLX-Audio library to synthesize the script in your parent's cloned voice signature.
- **Twilio & Caller ID Spoofing:** Handles the telephony aspect entirely through Twilio, allowing the use of your parent’s verified phone number as the outgoing Caller ID, maximizing perceived legitimacy.- **Centralized Configuration:** Single `config.py` file manages all settings and environment variables with validation.
- **Clean Logs:** Flask and Ngrok output goes to log files, keeping your terminal clean.

## How it works

Skipper operates as a robust, multi-stage pipeline, moving from data ingestion to physical voice delivery with zero human intervention.

1. **Data Acquisition (`calendar_scraper.py`):** The system first accesses your Google Calendar API credentials to pull all scheduled absences for the target week. This is the core input data.
2. **Intelligent Script Generation (`generate_phrase.py`):** The raw absence data is then fed into the local LLM (Qwen). The LLM uses a highly constrained system prompt to transform simple dates into a natural, conversational script, guaranteeing context and tone.
3. **Audio Synthesis (`generate_audio.py`):** The generated text is immediately passed to the MLX-Audio pipeline. This model takes a reference voice sample and generates a high-fidelity audio file of the parent reading the script.
4. **Web Bridge (`app.py`):** A minimal Flask server runs behind `ngrok`. This server acts as a secure, accessible endpoint that Twilio can call, requesting the synthesized audio file based on a unique session ID.
5. **Orchestration & Delivery (`main.py`):** The main script coordinates the final action: triggering the Twilio API to make the outbound call, which connects to the Flask server to retrieve and play the pre-generated audio file. Both tracks of the call can be recorded to ensure the system works properly as well.

This multi-step process ensures that the call sounds authentic, the message is precise, and the technical workflow is robust.

## Tech stack

Skipper is a distributed, local-first system.

| Layer               | Technology      | Purpose                                                                               |
| :------------------ | :-------------- | :------------------------------------------------------------------------------------ |
| **Core Language**   | Python 3.11+    | Orchestration, API scripting, and data handling.                                      |
| **Package Manager** | UV              | Fast Python package and dependency management.                                        |
| **Local AI/LLM**    | Ollama (Qwen)   | Runs the local Large Language Model for script generation.                            |
| **Voice Synthesis** | MLX-Audio       | Handles state-of-the-art, high-fidelity voice cloning (TTS).                          |
| **Communication**   | Twilio API      | The outbound call mechanism, connecting the system to the real world.                 |
| **Web Server**      | Flask / `ngrok` | Provides the necessary public-facing endpoint for Twilio to access the audio payload. |

## Limitations & Prerequisites

While highly functional, the project relies on several external components and technical prerequisites. These points are noted to ensure users understand the setup requirements and potential limitations:

- **Local Dependencies:** Due to specialized libraries (e.g., MLX-Audio optimized for Apple Silicon), cross-platform compatibility for certain features (like voice cloning) may require manual library swapping or specific hardware environments.
- **AI Backend:** The local text generation engine requires the use of Ollama. This can be easily bypassed by integrating alternative cloud AI providers (e.g., OpenAI API) if a local server setup is undesirable.
- **Telephony Service:** Full functionality, particularly advanced features like Caller ID masking, requires a paid Twilio account subscription.

_I will likely have to contanerize the application in something like Docker, to make it easier to distribute, and use._

## Running locally.

Before running, remember that this project requires several external services (Ollama, Twilio account, Google credentials) to be configured via the `secrets.env` file.

1. **Clone the Repository:**

   ```bash
   git clone https://github.com/your-username/skipper.git
   cd skipper
   ```

2. **Install Dependencies:**
   This command installs all necessary Python libraries.

   ```bash
   uv pip install -r requirements.txt
   ```

3. **Configure Environment Variables:**
   Create a file named `secrets.env` and fill in all your credentials:

   ```env
   # Example .env structure
   TWILIO_ACCOUNT_SID="..."
   TWILIO_AUTH_TOKEN="..."
   # ... other keys
   ```

4. **Update the system prompt:**
   Update `system_prompts/system_prompt_V5.md` with your information, so that the script is much more tailored and accurate.

5. **Run the Automation:**
   Execute the main script to trigger the full cycle:

   ```bash
   uv run main.py
   ```

   _(Wait for the process to confirm the call was placed and the audio was delivered!)_

   <!-- **CLI Options:**
   - `uv run main.py --no-services`: Skip starting Flask/Ngrok services (for offline testing)
   - `uv run main.py --test-script`: Test script generation without audio synthesis or calls -->

   **Log Files:**
   Flask and Ngrok output is automatically logged to `logs/flask.log` and `logs/ngrok.log` to keep your terminal clean.

## What's next.

The system is inherently modular, and while it's functional now, the true potential is vast. Here's the roadmap to ultimate freedom:

- **Multi-Call Scheduling:** Implement advanced scheduling to call at random, non-robotic times to enhance realism.
- **Voice Profile Manager:** Allow switching between multiple parent voices with simple configuration changes.
- **Manual Override CLI:** Dedicated command-line tool to generate and play a single, emergency audio file without touching the calendar logic.
- **Email Integration:** Expand functionality to handle notifications via automated email, reporting absences as well as calling.
- **Configurable Tone Profiles:** Allow defining different tones (e.g., "Very Concerned," "Mildly Casual," "Disappointed") for the AI script generator.

---

<div align="center">

bc school teaches jack\*\*\*\* • 💩

_Happy skipping._

</div>
