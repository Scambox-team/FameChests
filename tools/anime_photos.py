"""Zdjęcia kart w stylu anime dla wariantu Anime (`anime` w server/data/game.json, "photo" + "photoAll").

Narzędzie dla admina, uruchamiane ręcznie na swoim komputerze - serwer gry go nie potrzebuje. Bierze zdjęcia kart
z image_cache/ (<id>.jpg / .png / .webp) i zapisuje obok wersję anime: image_cache/<id>__anime.webp. Serwer pokazuje
ją jako zdjęcie karty w wariancie Anime (/img/<id>/anime). Przed pushem `cargo run --release -- export-catalog`
kopiuje te pliki do custom_images/, więc trafiają też do scambox.exe.

Model: AnimeGANv2 (port PyTorch: https://github.com/bryandlee/animegan2-pytorch), wagi face_paint_512_v2 - wytrenowane
na portretach, więc dobrze pasują do zdjęć osób. Pobiera je torch.hub przy pierwszym uruchomieniu (ok. 8 MB,
do ~/.cache/torch/hub). Oryginalny AnimeGANv2 jest do użytku niekomercyjnego - gra nie ma monetyzacji.

Instalacja (raz, w osobnym środowisku):
    py -m venv .venv-anime
    .venv-anime\\Scripts\\pip install --use-feature=truststore torch --index-url https://download.pytorch.org/whl/cpu
    .venv-anime\\Scripts\\pip install --use-feature=truststore pillow numpy truststore
(truststore = certyfikaty z Windows; bez niego antywirus sprawdzający HTTPS psuje pobieranie: CERTIFICATE_VERIFY_FAILED)

Użycie (z głównego folderu gry):
    cargo run --release -- fetch-images          # w server/: najpierw pobierz brakujące zdjęcia z Wikipedii
    .venv-anime\\Scripts\\python tools\\anime_photos.py                # wszystkie karty bez zdjęcia anime
    .venv-anime\\Scripts\\python tools\\anime_photos.py pl_adrian_zandberg --force   # wybrane karty od nowa
Opcje: --src FOLDER (domyślnie image_cache, na serwerze DATA_DIR/image_cache), --side N (dłuższy bok, domyślnie 640),
--force (nadpisz istniejące).
"""

import argparse
import sys
from pathlib import Path

EXTS = (".jpg", ".png", ".webp")
SUFFIX = "__anime"


def main_photos(src: Path, only: list[str]) -> list[Path]:
    """Zwykłe zdjęcia kart (bez __alt, __<wariant> i plików pomocniczych)"""
    out = []
    for p in sorted(src.iterdir()):
        if p.suffix.lower() not in EXTS or "__" in p.stem or p.stem.startswith("_"):
            continue
        if only and p.stem not in only:
            continue
        out.append(p)
    return out


WEIGHTS_URL = "https://github.com/bryandlee/animegan2-pytorch/raw/main/weights/face_paint_512_v2.pt"


def build_generator():
    """Sieć AnimeGANv2 (jak model.py z bryandlee/animegan2-pytorch) - przepisana tutaj, żeby z internetu pobierać
    tylko wagi (dane), a nie kod uruchamiany przez torch.hub"""
    import torch.nn.functional as F
    from torch import nn

    class ConvNormLReLU(nn.Sequential):
        def __init__(self, cin, cout, kernel_size=3, stride=1, padding=1, groups=1, bias=False):
            super().__init__(
                nn.ReflectionPad2d(padding),
                nn.Conv2d(cin, cout, kernel_size=kernel_size, stride=stride, padding=0, groups=groups, bias=bias),
                nn.GroupNorm(num_groups=1, num_channels=cout, affine=True),
                nn.LeakyReLU(0.2, inplace=True),
            )

    class InvertedResBlock(nn.Module):
        def __init__(self, cin, cout, expansion_ratio=2):
            super().__init__()
            self.use_res_connect = cin == cout
            mid = int(round(cin * expansion_ratio))
            layers = [ConvNormLReLU(cin, mid, kernel_size=1, padding=0)] if expansion_ratio != 1 else []
            layers += [
                ConvNormLReLU(mid, mid, groups=mid, bias=True),
                nn.Conv2d(mid, cout, kernel_size=1, padding=0, bias=False),
                nn.GroupNorm(num_groups=1, num_channels=cout, affine=True),
            ]
            self.layers = nn.Sequential(*layers)

        def forward(self, x):
            out = self.layers(x)
            return x + out if self.use_res_connect else out

    class Generator(nn.Module):
        def __init__(self):
            super().__init__()
            self.block_a = nn.Sequential(ConvNormLReLU(3, 32, kernel_size=7, padding=3),
                                         ConvNormLReLU(32, 64, stride=2, padding=(0, 1, 0, 1)), ConvNormLReLU(64, 64))
            self.block_b = nn.Sequential(ConvNormLReLU(64, 128, stride=2, padding=(0, 1, 0, 1)), ConvNormLReLU(128, 128))
            self.block_c = nn.Sequential(ConvNormLReLU(128, 128), InvertedResBlock(128, 256, 2), InvertedResBlock(256, 256, 2),
                                         InvertedResBlock(256, 256, 2), InvertedResBlock(256, 256, 2), ConvNormLReLU(256, 128))
            self.block_d = nn.Sequential(ConvNormLReLU(128, 128), ConvNormLReLU(128, 128))
            self.block_e = nn.Sequential(ConvNormLReLU(128, 64), ConvNormLReLU(64, 64), ConvNormLReLU(64, 32, kernel_size=7, padding=3))
            self.out_layer = nn.Sequential(nn.Conv2d(32, 3, kernel_size=1, stride=1, padding=0, bias=False), nn.Tanh())

        def forward(self, x):
            out = self.block_a(x)
            half = out.size()[-2:]
            out = self.block_c(self.block_b(out))
            out = self.block_d(F.interpolate(out, half, mode="bilinear", align_corners=True))
            out = self.block_e(F.interpolate(out, x.size()[-2:], mode="bilinear", align_corners=True))
            return self.out_layer(out)

    return Generator()


def load_model(device):
    import urllib.request

    import torch

    try:
        import truststore

        truststore.inject_into_ssl()
    except ImportError:
        pass

    path = Path(torch.hub.get_dir()) / "checkpoints" / "face_paint_512_v2.pt"
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        print(f"Pobieram wagi modelu: {WEIGHTS_URL}")
        urllib.request.urlretrieve(WEIGHTS_URL, path)
    model = build_generator()
    model.load_state_dict(torch.load(path, map_location="cpu", weights_only=True))  # strict: zła sieć = błąd
    return model.to(device).eval()


def to_anime(model, device, path: Path, side: int):
    import numpy as np
    import torch
    from PIL import Image, ImageOps

    img = ImageOps.exif_transpose(Image.open(path)).convert("RGB")
    # dłuższy bok = side, oba boki podzielne przez 8 (sieć zmniejsza obraz trzy razy o połowę)
    scale = side / max(img.size)
    w, h = (max(8, round(x * scale / 8) * 8) for x in img.size)
    img = img.resize((w, h), Image.LANCZOS)
    x = torch.from_numpy(np.asarray(img, dtype=np.float32) / 127.5 - 1).permute(2, 0, 1).unsqueeze(0).to(device)
    with torch.no_grad():
        y = model(x).squeeze(0).clamp(-1, 1)
    arr = ((y.permute(1, 2, 0).cpu().numpy() + 1) * 127.5).round().astype("uint8")
    return Image.fromarray(arr)


def main():
    ap = argparse.ArgumentParser(description="Zdjęcia kart w stylu anime (AnimeGANv2) dla wariantu Anime")
    ap.add_argument("ids", nargs="*", help="id kart (domyślnie wszystkie)")
    ap.add_argument("--src", default="image_cache", help="folder ze zdjęciami kart")
    ap.add_argument("--side", type=int, default=640, help="dłuższy bok wyniku w pikselach")
    ap.add_argument("--force", action="store_true", help="nadpisz istniejące zdjęcia anime")
    args = ap.parse_args()

    src = Path(args.src)
    if not src.is_dir():
        sys.exit(f"Brak folderu {src} - uruchom z głównego folderu gry albo podaj --src")
    todo = [p for p in main_photos(src, args.ids) if args.force or not (src / f"{p.stem}{SUFFIX}.webp").exists()]
    if not todo:
        print("Nic do zrobienia - wszystkie karty mają już zdjęcie anime (--force, żeby zrobić od nowa).")
        return

    import torch

    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"Model AnimeGANv2 (face_paint_512_v2) na {device}, zdjęć: {len(todo)}")
    model = load_model(device)
    for i, p in enumerate(todo, 1):
        out = src / f"{p.stem}{SUFFIX}.webp"
        try:
            to_anime(model, device, p, args.side).save(out, "WEBP", quality=88, method=6)
            print(f"[{i}/{len(todo)}] {p.stem}")
        except Exception as e:  # jedno złe zdjęcie nie przerywa całej reszty
            print(f"[{i}/{len(todo)}] {p.stem}: błąd - {e}")
    print(f"Gotowe. Zdjęcia: {src}/<id>{SUFFIX}.webp - przed pushem: cargo run --release -- export-catalog (w server/)")


if __name__ == "__main__":
    main()
