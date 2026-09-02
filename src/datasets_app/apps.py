from django.apps import AppConfig
from django.db.backends.signals import connection_created


def configure_sqlite(sender, connection, **kwargs):  # type: ignore[no-untyped-def]
    if connection.vendor != "sqlite":
        return
    with connection.cursor() as cursor:
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.execute("PRAGMA busy_timeout=20000")
        if connection.settings_dict["NAME"] != ":memory:":
            cursor.execute("PRAGMA journal_mode=WAL")


class DatasetsAppConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "datasets_app"

    def ready(self) -> None:
        connection_created.connect(configure_sqlite, dispatch_uid="dataset-studio-sqlite")
