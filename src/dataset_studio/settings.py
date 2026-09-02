import os
from pathlib import Path

from platformdirs import user_data_path

BASE_DIR = Path(__file__).resolve().parents[2]
APP_DATA_DIR = Path(
    os.environ.get("DATASET_STUDIO_DATA_DIR", user_data_path("Dataset Studio", ensure_exists=True))
)

SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY", "dataset-studio-local-development-key")
DEBUG = os.environ.get("DJANGO_DEBUG", "1") == "1"
ALLOWED_HOSTS = ["127.0.0.1", "localhost", "testserver"]

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "datasets_app.apps.DatasetsAppConfig",
]
MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]
ROOT_URLCONF = "dataset_studio.urls"
TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [BASE_DIR / "src" / "dataset_studio" / "templates"],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ]
        },
    }
]
WSGI_APPLICATION = "dataset_studio.wsgi.application"
ASGI_APPLICATION = "dataset_studio.asgi.application"

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": os.environ.get("DATASET_STUDIO_DB", str(APP_DATA_DIR / "dataset-studio.sqlite3")),
        "OPTIONS": {"timeout": 20},
    }
}
AUTH_PASSWORD_VALIDATORS = []
LANGUAGE_CODE = "ja"
TIME_ZONE = os.environ.get("TZ", "Asia/Tokyo")
USE_I18N = True
USE_TZ = True
STATIC_URL = "static/"
STATICFILES_DIRS = [BASE_DIR / "frontend" / "dist"]
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
