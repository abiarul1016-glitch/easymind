from django.contrib import admin
from django.urls import include, path
from rest_framework.routers import DefaultRouter

from easymind.views import ReminderViewSet, ai_parse_reminder, ai_polish_title

router = DefaultRouter()
router.register("reminders", ReminderViewSet, basename="reminder")

urlpatterns = [

    path('', include('easymind.urls')),

    path("admin/", admin.site.urls),
    path('api/', include(router.urls)),

    # AI endpoints (backed by local Ollama)
    path('api/ai/parse/',  ai_parse_reminder, name='ai-parse'),
    path('api/ai/polish/', ai_polish_title,   name='ai-polish'),

    # DRF session login (useful for browsable API during dev)
    path('api/auth/', include('rest_framework.urls')),
]
