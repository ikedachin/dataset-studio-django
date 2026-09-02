from django.http import HttpRequest, HttpResponse
from django.shortcuts import render


def spa_index(request: HttpRequest) -> HttpResponse:
    return render(request, "dataset_studio/index.html")
