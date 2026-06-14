from django.shortcuts import render
from rest_framework import viewsets
from ..models import Reminder
from .serializers import ReminderSerializer

# Create your views here.
class ReminderViewSet(viewsets.ModelViewSet):
    queryset = Reminder.objects.all()
    serializer_class = ReminderSerializer