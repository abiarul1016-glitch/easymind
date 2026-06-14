from django.conf import settings
from django.db import models


# Create your models here.
class Reminder(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='reminders')
    title = models.CharField(max_length=250)
    date = models.DateField()
    time = models.TimeField(blank=True, null=True)
    location = models.CharField(blank=True)

    def __str__(self):
        return f'{self.title} @ {self.date}'
