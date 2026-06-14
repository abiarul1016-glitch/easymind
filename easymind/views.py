import json
import logging

from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_POST
from rest_framework import viewsets, permissions
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated, AllowAny
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
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        return Reminder.objects.filter(user=self.request.user).order_by('date', 'time')


# ─── Ollama AI Parse endpoint ─────────────────────────────────────────────────

@api_view(['POST'])
@permission_classes([IsAuthenticated])
def ai_parse_reminder(request):
    """
    POST /api/ai/parse/
    Body: { "text": "Apply for OSAP by June 15th at 5pm" }
    Returns: { "title": "...", "date": "YYYY-MM-DD", "time": "HH:MM:SS", "location": "" }

    Uses Ollama running locally. Falls back gracefully if Ollama is unavailable.
    """
    text = request.data.get('text', '').strip()
    if not text:
        return Response({'error': 'text is required'}, status=400)

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
            model='llama3.2',   # change to whichever model you have pulled
            messages=[{'role': 'user', 'content': prompt}],
            options={'temperature': 0}
        )
        raw = response['message']['content'].strip()

        # Strip markdown code fences if model adds them
        if raw.startswith('```'):
            raw = raw.split('```')[1]
            if raw.startswith('json'):
                raw = raw[4:]
        raw = raw.strip()

        parsed = json.loads(raw)
        return Response({
            'title':    parsed.get('title', text),
            'date':     parsed.get('date') or None,
            'time':     parsed.get('time') or None,
            'location': parsed.get('location', ''),
        })

    except ImportError:
        logger.warning('ollama package not installed — pip install ollama')
        return Response({'error': 'ollama not installed'}, status=503)
    except Exception as e:
        logger.error(f'Ollama parse failed: {e}')
        return Response({'error': str(e)}, status=503)


# ─── Ollama AI Polish endpoint ─────────────────────────────────────────────────

@api_view(['POST'])
@permission_classes([IsAuthenticated])
def ai_polish_title(request):
    """
    POST /api/ai/polish/
    Body: { "text": "apply for osap thingo by june" }
    Returns: { "title": "Apply for OSAP by June 15" }
    """
    text = request.data.get('text', '').strip()
    if not text:
        return Response({'error': 'text is required'}, status=400)

    prompt = f"""Clean up this reminder title. Make it concise, clear, and action-oriented.
Return ONLY the cleaned title — no quotes, no explanation, max 10 words.

Raw text: {text}"""

    try:
        import ollama
        response = ollama.chat(
            model='llama3.2',
            messages=[{'role': 'user', 'content': prompt}],
            options={'temperature': 0}
        )
        title = response['message']['content'].strip().strip('"').strip("'")
        return Response({'title': title})

    except ImportError:
        return Response({'title': text})   # graceful fallback: return as-is
    except Exception as e:
        logger.error(f'Ollama polish failed: {e}')
        return Response({'title': text})   # graceful fallback
