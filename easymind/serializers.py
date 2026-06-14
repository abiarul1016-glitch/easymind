from rest_framework import serializers

from .models import Reminder


class ReminderSerializer(serializers.ModelSerializer):
    # user is set automatically from request.user when available.
    # When the client is unauthenticated, user will be saved as None.
    user = serializers.PrimaryKeyRelatedField(read_only=True)

    class Meta:
        model = Reminder
        fields = "__all__"

    def create(self, validated_data):
        request = self.context.get("request")
        user = None
        if (
            request is not None
            and hasattr(request, "user")
            and request.user.is_authenticated
        ):
            user = request.user
        return Reminder.objects.create(user=user, **validated_data)
