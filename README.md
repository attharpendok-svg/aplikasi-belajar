# 📚 Aplikasi Belajar

Aplikasi web sederhana untuk belajar dengan metode:

1. **Ringkas PPT dosen**: upload file `.pptx` / `.pdf`, teks tiap slide diambil otomatis (termasuk catatan pembicara), lalu tulis ringkasan dengan kata-katamu sendiri di sebelahnya.
2. **Latihan soal sebanyak-banyaknya**: dari bank soal, soal otomatis dari ringkasan, dan soal buatan AI.

Tidak perlu login atau server. Semua data tersimpan di browser (localStorage).

## Cara menjalankan

- **Paling mudah:** buka `index.html` langsung di browser (Chrome/Edge/Firefox).
- **Online (bisa dibuka di HP):** aktifkan GitHub Pages di *Settings → Pages → Deploy from a branch*, lalu pilih branch-nya. Aplikasi bisa dibuka di `https://<username>.github.io/aplikasi-belajar/`.
- **Lokal via server:** `python3 -m http.server` lalu buka `http://localhost:8000`.

Semua pustaka sudah ada di folder `lib/`, jadi aplikasi tetap jalan tanpa internet.

## Fitur

### 📝 Slide & Ringkasan
- Upload `.pptx`, `.pdf`, atau `.txt` (klik atau seret file).
- Tombol **+ ke ringkasan** menyalin teks slide ke editor untuk diringkas.
- Editor Markdown dengan pratinjau, stabilo (`==teks==`), judul, dan poin.
- Tersimpan otomatis.

### ✨ Soal otomatis dari ringkasan
| Tulis di ringkasan | Jadi soal |
|---|---|
| `- **Mitokondria** adalah tempat respirasi sel.` | Isian: "_____ adalah tempat respirasi sel." → *Mitokondria* |
| `Kofaktor :: zat non-protein yang dibutuhkan enzim` | Flashcard dua arah (istilah → arti dan arti → istilah) |

Jadi semakin rapi ringkasanmu, semakin banyak soal latihan yang muncul.

### ❓ Bank soal
- Tambah soal manual: pilihan ganda, benar/salah, atau isian.
- **Impor dari teks**: tempel banyak soal sekaligus dengan format:
  ```
  1. Organel tempat respirasi sel adalah...
  A. Ribosom
  B. Mitokondria
  C. Lisosom
  D. Badan Golgi
  Jawaban: B
  Penjelasan: Mitokondria menghasilkan ATP.

  2. Enzim yang memecah amilum disebut...
  Jawaban: amilase
  ```
- **🤖 Buat soal pakai AI**: aplikasi menyusun prompt dari ringkasan atau slide-mu. Salin, tempel di ChatGPT/Claude/Gemini, lalu tempel hasilnya ke *Impor dari teks*. Cara tercepat untuk mendapat 30–100 soal per materi.

### ▶ Latihan
- Pilih materi (bisa beberapa sekaligus), sumber soal, dan jumlah soal.
- Mode **Pintar**: soal yang sering salah, belum pernah dicoba, atau sudah lama tidak dilihat muncul lebih dulu.
- Mode **Hanya yang pernah salah** dan tombol **Ulangi yang salah** setelah selesai.
- Jawaban isian toleran salah ketik kecil. Ada tombol "Sebenarnya jawabanku benar" kalau penilaian otomatis keliru.
- Pintasan keyboard: `A`–`E` / `1`–`5` untuk memilih jawaban, `Enter` untuk lanjut, `Spasi` untuk membuka flashcard.

### 💾 Backup
Data hanya ada di browser yang dipakai. Gunakan menu **Backup → Ekspor** secara rutin, dan **Impor** untuk memindahkan data ke perangkat lain.

## Struktur
```
index.html   halaman utama
style.css    tampilan (mendukung mode gelap)
app.js       seluruh logika aplikasi
lib/         JSZip (baca PPTX), pdf.js (baca PDF), marked + DOMPurify (Markdown)
```
