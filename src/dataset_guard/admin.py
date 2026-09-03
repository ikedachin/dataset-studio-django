from django.contrib import admin

from .models import GuardAuditLog


@admin.register(GuardAuditLog)
class GuardAuditLogAdmin(admin.ModelAdmin):
    list_display = ("executed_at", "target_type", "target_id", "action", "result", "actor")
    list_filter = ("target_type", "action", "result")
    search_fields = ("target_id", "confirmation_text", "message", "actor")
    readonly_fields = ("executed_at",)

