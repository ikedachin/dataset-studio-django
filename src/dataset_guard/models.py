from django.db import models


class GuardAuditLog(models.Model):
    class TargetType(models.TextChoices):
        PROJECT = "project", "Project"
        SPLIT = "split", "Split"

    class ActionType(models.TextChoices):
        PROTECT = "protect", "Protect"
        UNPROTECT = "unprotect", "Unprotect"
        SOFT_DELETE = "soft_delete", "Soft delete"
        HARD_DELETE = "hard_delete", "Hard delete"

    class ResultType(models.TextChoices):
        SUCCESS = "success", "Success"
        REJECTED = "rejected", "Rejected"

    target_type = models.CharField(max_length=20, choices=TargetType.choices)
    target_id = models.CharField(max_length=255)
    action = models.CharField(max_length=30, choices=ActionType.choices)
    confirmation_text = models.CharField(max_length=255)
    result = models.CharField(max_length=20, choices=ResultType.choices)
    message = models.TextField(blank=True)
    actor = models.CharField(max_length=80, default="local-user")
    executed_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-executed_at", "-id"]

