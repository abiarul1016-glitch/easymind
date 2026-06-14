from rest_framework import serializers
from .models import Reminder


class ReminderSerializer(serializers.ModelSerializer):
    # user is set automatically from request.user — never sent by the client
    user = serializers.HiddenField(default=serializers.CurrentUserDefault())

    class Meta:
        model = Reminder
        fields = "__all__"
