from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit
import os


ROOT = Path(__file__).resolve().parent
PUBLIC = ROOT / "public"
BASE_PATH = os.environ.get("BASE_PATH", "/__mockup/").rstrip("/")
PORT = int(os.environ.get("PORT", "23636"))


class PreviewHandler(SimpleHTTPRequestHandler):
    def translate_path(self, request_path):
        pathname = unquote(urlsplit(request_path).path)
        if pathname == BASE_PATH or pathname == BASE_PATH + "/":
            relative = "index.html"
        elif pathname.startswith(BASE_PATH + "/"):
            relative = pathname[len(BASE_PATH) + 1 :]
        else:
            relative = pathname.lstrip("/")

        routes = {
            "preview/customer-workspace/Current": "previews/current.html",
            "preview/customer-workspace/Redesign": "previews/redesign.html",
        }
        relative = routes.get(relative.rstrip("/"), relative)
        target = (PUBLIC / relative).resolve()

        if target != PUBLIC.resolve() and PUBLIC.resolve() not in target.parents:
            return str(PUBLIC / "index.html")
        if target.is_dir():
            target = target / "index.html"
        return str(target)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


if __name__ == "__main__":
    server = ThreadingHTTPServer(("0.0.0.0", PORT), PreviewHandler)
    print(f"Static mockup preview listening on port {PORT}", flush=True)
    server.serve_forever()
