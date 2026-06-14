import json
import logging

from django.contrib.auth import authenticate, login, logout
from django.contrib.auth.models import User
from django.http import JsonResponse
from django.middleware.csrf import get_token
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import ensure_csrf_cookie
from rest_framework import viewsets, permissions, status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated, AllowAny
from rest_framework.response import Response

from ..models import Reminder
from ..serializers import ReminderSerializer

logger = logging.getLogger(__name__)


# ─── CSRF cookie endpoint ──────────────────────────────────────────────────────
# JS fetches this once on load — Django sets the csrftoken cookie in the response.
@api_view(['GET'])
@permission_classes([AllowAny])
def csrf_token_view(request):
    return Response({'csrfToken': get_token(request)})


# ─── Auth: whoami ──────────────────────────────────────────────────────────────
@api_view(['GET'])
@permission_classes([AllowAny])
def whoami(request):
    if request.user.is_authenticated:
        return Response({
            'authenticated': True,
            'username': request.user.username,
            'is_guest': request.user.username.startswith('guest_'),
        })
    return Response({'authenticated': False})


# ─── Auth: guest auto-login ────────────────────────────────────────────────────
@api_view(['POST'])
@permission_classes([AllowAny])
def guest_login(request):
    """
    Creates a one-off guest user and logs them in, so they get a session
    cookie and the app works without any signup friction.
    Guest accounts are prefixed with 'guest_' so they can be culled later.
    """
    import uuid
    username = f'guest_{uuid.uuid4().hex[:10]}'
    password = uuid.uuid4().hex
    user = User.objects.create_user(username=username, password=password)
    user = authenticate(request, username=username, password=password)
    login(request, user)
    return Response({
        'authenticated': True,
        'username': username,
        'is_guest': True,
    })


# ─── Auth: register ────────────────────────────────────────────────────────────
@api_view(['POST'])
@permission_classes([AllowAny])
def register(request):
    username = request.data.get('username', '').strip()
    password = request.data.get('password', '').strip()

    if not username or not password:
        return Response({'error': 'Username and password are required.'}, status=400)
    if len(password) < 6:
        return Response({'error': 'Password must be at least 6 characters.'}, status=400)
    if User.objects.filter(username=username).exists():
        return Response({'error': 'Username already taken.'}, status=409)

    # If the current user is a guest, upgrade them in-place instead of creating a new account.
    if request.user.is_authenticated and request.user.username.startswith('guest_'):
        user = request.user
        user.username = username
        user.set_password(password)
        user.save()
        login(request, user)  # refresh session
        return Response({'authenticated': True, 'username': username, 'is_guest': False})

    user = User.objects.create_user(username=username, password=password)
    user = authenticate(request, username=username, password=password)
    login(request, user)
    return Response({'authenticated': True, 'username': username, 'is_guest': False})


# ─── Auth: login ──────────────────────────────────────────────────────────────
@api_view(['POST'])
@permission_classes([AllowAny])
def login_view(request):
    username = request.data.get('username', '').strip()
    password = request.data.get('password', '').strip()
    user = authenticate(request, username=username, password=password)
    if user:
        login(request, user)
        return Response({
            'authenticated': True,
            'username': username,
            'is_guest': username.startswith('guest_'),
        })
    return Response({'error': 'Invalid credentials.'}, status=401)


# ─── Auth: logout ─────────────────────────────────────────────────────────────
@api_view(['POST'])
@permission_classes([IsAuthenticated])
def logout_view(request):
    logout(request)
    return Response({'authenticated': False})


# ─── Reminder CRUD ────────────────────────────────────────────────────────────
class ReminderViewSet(viewsets.ModelViewSet):
    serializer_class = ReminderSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return Reminder.objects.filter(user=self.request.user).order_by('date', 'time')


# ─── AI: parse reminder text ──────────────────────────────────────────────────
@api_view(['POST'])
@permission_classes([IsAuthenticated])
def ai_parse_reminder(request):
    """
    POST /api/ai/parse/
    { "text": "Apply for OSAP by June 15th at 5pm" }
    → { "title": "...", "date": "YYYY-MM-DD", "time": "HH:MM:SS", "location": "" }

    Uses dateparser for robust date/time extraction, then Ollama for title cleaning.
    Falls back gracefully if Ollama is unavailable.
    """
    text = request.data.get('text', '').strip()
    if not text:
        return Response({'error': 'text is required'}, status=400)

    from datetime import date as date_type
    import re

    # ── dateparser for date + time ──────────────────────────────────────────
    date_str = None
    time_str = None
    clean_text = text

    try:
        import dateparser
        settings = {
            'PREFER_DATES_FROM': 'future',
            'RETURN_AS_TIMEZONE_AWARE': False,
            'RELATIVE_BASE': __import__('datetime').datetime.now(),
        }

        # Try to find and extract the date/time phrase
        parsed_dt = dateparser.parse(text, settings=settings)
        if parsed_dt:
            date_str = parsed_dt.strftime('%Y-%m-%d')
            # Only store time if the original text mentioned it
            time_indicators = re.search(r'\b(\d{1,2}(:\d{2})?\s*(am|pm)|at\s+\d|by\s+\d|noon|midnight|morning|evening|night)\b', text, re.I)
            if time_indicators:
                time_str = parsed_dt.strftime('%H:%M:%S')

            # Strip date/time words from title
            date_patterns = [
                r'\b(today|tonight|tomorrow|yesterday)\b',
                r'\b(next|this)?\s*(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b',
                r'\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2}(?:st|nd|rd|th)?\b',
                r'\b\d{1,2}(?:st|nd|rd|th)?\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b',
                r'\b\d{1,2}/\d{1,2}(?:/\d{2,4})?\b',
                r'\bin\s+\d+\s+(day|days|week|weeks)\b',
                r'\b(at|by|@)\s+\d{1,2}(:\d{2})?\s*(am|pm)?\b',
                r'\b\d{1,2}(:\d{2})?\s*(am|pm)\b',
                r'\b(noon|midnight|morning|evening|night|tonight)\b',
            ]
            for pat in date_patterns:
                clean_text = re.sub(pat, '', clean_text, flags=re.IGNORECASE)

            clean_text = re.sub(r'\s{2,}', ' ', clean_text).strip().strip(',').strip()

    except ImportError:
        logger.warning('dateparser not installed — pip install dateparser')

    # ── Ollama for title polishing ──────────────────────────────────────────
    title = clean_text or text
    try:
        import ollama
        prompt = f'Clean up this reminder title. Make it concise, clear, and action-oriented. Max 10 words. Return ONLY the title, no quotes, no explanation.\n\nRaw: {clean_text or text}'
        response = ollama.chat(
            model='llama3.2qwen3.5:9b',
            messages=[{'role': 'user', 'content': prompt}],
            options={'temperature': 0}
        )
        title = response['message']['content'].strip().strip('"').strip("'")
    except ImportError:
        logger.warning('ollama not installed — pip install ollama')
    except Exception as e:
        logger.warning(f'Ollama unavailable: {e}')

    return Response({
        'title':    title,
        'date':     date_str,
        'time':     time_str,
        'location': '',
    })


# ─── AI: polish title only ────────────────────────────────────────────────────
@api_view(['POST'])
@permission_classes([IsAuthenticated])
def ai_polish_title(request):
    text = request.data.get('text', '').strip()
    if not text:
        return Response({'error': 'text is required'}, status=400)

    try:
        import ollama
        prompt = f'Clean up this reminder title. Make it concise, clear, and action-oriented. Max 10 words. Return ONLY the title, no quotes.\n\nRaw: {text}'
        response = ollama.chat(
            model='llama3.2',
            messages=[{'role': 'user', 'content': prompt}],
            options={'temperature': 0}
        )
        title = response['message']['content'].strip().strip('"').strip("'")
        return Response({'title': title})
    except Exception as e:
        logger.warning(f'Ollama polish failed: {e}')
        return Response({'title': text})  # graceful fallback
