from django.contrib import admin
from django.urls import include, path

from datasets_app.views.spa import spa_index

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/", include("datasets_app.urls")),
    path("api/management/", include("dataset_guard.urls")),
    path("management", spa_index, name="management-index"),
    path("management/", spa_index, name="management-index-slash"),
    path("", spa_index, name="spa-index"),
]
