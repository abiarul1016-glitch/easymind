import json
import logging

from django.http import JsonResponse
from django.shortcuts import render
from django.views.decorators.csrf import csrf_exempt, ensure_csrf_cookie
from django.views.decorators.http import require_POST
from rest_framework import permissions, viewsets
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response

from .models import Reminder
from .serializers import ReminderSerializer

logger = logging.getLogger(__name__)


# ─── Reminder CRUD ────────────────────────────────────────────────────────────


class ReminderViewSet(viewsets.ModelViewSet):
    """
    Standard CRUD for reminders.
    - Only returns the logged-in user's reminders.
    - Automatically assigns request.user on create (via HiddenField in serializer).
    """

    serializer_class = ReminderSerializer
    permission_classes = [AllowAny]

    def get_queryset(self):
        # For authenticated users, return only their reminders.
        # For guests (demo), return all reminders so the frontend can show something.
        if hasattr(self.request, "user") and self.request.user.is_authenticated:
            return Reminder.objects.filter(user=self.request.user).order_by(
                "date", "time"
            )
        return Reminder.objects.all().order_by("date", "time")


@ensure_csrf_cookie
def index(request):
    return render(request, "easymind/app.html")


# ─── Ollama AI Parse endpoint ─────────────────────────────────────────────────


@api_view(["POST"])
@permission_classes([AllowAny])
def ai_parse_reminder(request):
    """
    POST /api/ai/parse/
    Body: { "text": "Apply for OSAP by June 15th at 5pm" }
    Returns: { "title": "...", "date": "YYYY-MM-DD", "time": "HH:MM:SS", "location": "" }

    Uses Ollama running locally. Falls back gracefully if Ollama is unavailable.
    """
    # Accept either { "text": "..." } or the frontend style { messages: [{ role, content }] }
    text = ""
    if isinstance(request.data, dict):
        text = request.data.get("text") or ""
        if not text:
            # try messages array
            msgs = request.data.get("messages") or request.data.get("Messages")
            if isinstance(msgs, (list, tuple)) and len(msgs) > 0:
                # find user content or use first
                content = None
                for m in msgs:
                    if (
                        isinstance(m, dict)
                        and m.get("role") == "user"
                        and m.get("content")
                    ):
                        content = m.get("content")
                        break
                if not content and isinstance(msgs[0], dict):
                    content = msgs[0].get("content")
                text = (content or "").strip()

    if not text:
        return Response({"error": "text is required"}, status=400)

    from datetime import date

    today_str = date.today().isoformat()

    prompt = f"""You are a reminder parser. Today is {today_str}.
Parse the following reminder text and return ONLY a valid JSON object with these keys:
- title: a clean, concise action-oriented title (max 10 words, no filler)
- date: the date in YYYY-MM-DD format, or null if not mentioned
- time: the time in HH:MM:SS 24-hour format, or null if not mentioned
- location: the location string, or empty string if none

Reminder text: "{text}"

Reply with ONLY the JSON object, no markdown, no explanation."""

    try:
        import ollama

        response = ollama.chat(
            model="qwen3.5:9b",
            messages=[{"role": "user", "content": prompt}],
            options={"temperature": 0},
            think=False,
        )
        raw = response["message"]["content"].strip()

        # Strip markdown code fences if model adds them
        if raw.startswith("```"):
            parts = raw.split("```")
            if len(parts) >= 2:
                raw = parts[1]
                if raw.startswith("json"):
                    raw = raw[4:]
        raw = raw.strip()

        # If the model returned a JSON object as text, return it as a string in content[0].text
        try:
            parsed = json.loads(raw)
            return Response({"content": [{"text": json.dumps(parsed)}]})
        except Exception:
            return Response({"content": [{"text": raw}]})

    except ImportError:
        logger.warning("ollama package not installed — falling back to python parsing")
    except Exception as e:
        logger.error(f"Ollama parse failed: {e}")

    # Python fallback using dateparser and regex heuristics
    try:
        import re

        import dateparser

        parsed_dt = dateparser.parse(text, settings={"PREFER_DATES_FROM": "future"})
        parsed_date = (
            parsed_dt.date().isoformat() if parsed_dt and parsed_dt.date() else None
        )
        parsed_time = None
        if parsed_dt and parsed_dt.time():
            parsed_time = parsed_dt.time().isoformat()

        # simple location detection
        loc_match = re.search(r"\b(?:at|@)\s+([A-Z][\w\s,.&'-]+)", text)
        location = loc_match.group(1).strip() if loc_match else ""

        # basic title cleanup: remove detected location and date phrases
        title = text
        if location:
            title = re.sub(
                r"\b(?:at|@)\s+%s" % re.escape(location), "", title, flags=re.I
            )
        # remove common words
        title = re.sub(
            r"\b(?:tomorrow|today|by|on|at)\b", "", title, flags=re.I
        ).strip()

        parsed_obj = {
            "title": title or text,
            "date": parsed_date,
            "time": parsed_time,
            "location": location or "",
        }
        return Response({"content": [{"text": json.dumps(parsed_obj)}]})
    except Exception as e:
        logger.error(f"Fallback parse failed: {e}")
        return Response({"error": "parse failed"}, status=503)


# ─── Ollama AI Polish endpoint ─────────────────────────────────────────────────


@api_view(["POST"])
@permission_classes([AllowAny])
def ai_polish_title(request):
    """
    POST /api/ai/polish/
    Accepts either `{ "text": "..." }` or the frontend style `{ messages: [{role, content}] }`.
    Returns: `{ content: [ { text: "Cleaned title" } ] }` for frontend compatibility.
    """
    # extract text from request
    text = ""
    if isinstance(request.data, dict):
        text = (request.data.get("text") or "").strip()
        if not text:
            msgs = request.data.get("messages") or request.data.get("Messages")
            if isinstance(msgs, (list, tuple)) and len(msgs) > 0:
                content = None
                for m in msgs:
                    if (
                        isinstance(m, dict)
                        and m.get("role") == "user"
                        and m.get("content")
                    ):
                        content = m.get("content")
                        break
                if not content and isinstance(msgs[0], dict):
                    content = msgs[0].get("content")
                text = (content or "").strip()

    if not text:
        return Response({"error": "text is required"}, status=400)

    prompt = f"Clean up this reminder title. Make it concise, clear, and action-oriented. Return ONLY the cleaned title — no quotes, no explanation, max 10 words.\n\nRaw text: {text}"

    try:
        import ollama

        response = ollama.chat(
            model="qwen3.5:9b",
            messages=[{"role": "user", "content": prompt}],
            options={"temperature": 0},
            think=False,
        )
        raw = response["message"]["content"].strip()
        # strip fences
        if raw.startswith("```"):
            parts = raw.split("```")
            if len(parts) >= 2:
                raw = parts[1]
        title = raw.strip().strip('"').strip("'")
        return Response({"content": [{"text": title}]})

    except ImportError:
        logger.warning("ollama package not installed — falling back to simple polish")
    except Exception as e:
        logger.error(f"Ollama polish failed: {e}")

    # Simple python fallback: small heuristic cleaner
    try:
        cleaned = " ".join(
            [
                w
                for w in text.split()
                if w.lower() not in ("a", "the", "for", "to", "my", "your", "please")
            ]
        )
        cleaned = cleaned.strip()
        # limit to 10 words
        cleaned = " ".join(cleaned.split()[:10])
        if not cleaned:
            cleaned = text
        return Response({"content": [{"text": cleaned}]})
    except Exception as e:
        logger.error(f"Fallback polish failed: {e}")
        return Response({"content": [{"text": text}]})
