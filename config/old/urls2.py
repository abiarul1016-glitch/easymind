from django.contrib import admin
from django.urls import include, path
from rest_framework.routers import DefaultRouter

from easymind.old.views2 import (
    ReminderViewSet,
    ai_parse_reminder,
    ai_polish_title,
    csrf_token_view,
    whoami,
    guest_login,
    register,
    login_view,
    logout_view,
)

router = DefaultRouter()
router.register("reminders", ReminderViewSet, basename="reminder")

urlpatterns = [
    path("admin/", admin.site.urls),
    path('api/', include(router.urls)),

    # Auth
    path('api/auth/csrf/',       csrf_token_view, name='csrf'),
    path('api/auth/whoami/',     whoami,          name='whoami'),
    path('api/auth/guest/',      guest_login,     name='guest-login'),
    path('api/auth/register/',   register,        name='register'),
    path('api/auth/login/',      login_view,      name='login'),
    path('api/auth/logout/',     logout_view,     name='logout'),

    # AI (Ollama)
    path('api/ai/parse/',        ai_parse_reminder, name='ai-parse'),
    path('api/ai/polish/',       ai_polish_title,   name='ai-polish'),
]
