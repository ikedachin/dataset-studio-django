from django.urls import path

from . import views

urlpatterns = [
    path("resources/", views.resources),
    path("audit-logs/", views.audit_logs),
    path("projects/<int:project_id>/actions/", views.project_action),
    path("splits/<int:split_id>/actions/", views.split_action),
]

