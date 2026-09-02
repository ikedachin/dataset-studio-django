from django.contrib import admin
from django.urls import include, path

from datasets_app.views.spa import spa_index

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/", include("datasets_app.urls")),
    path("", spa_index, name="spa-index"),
]
