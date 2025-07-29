// server.js

const express = require("express");
const { fetchTenderData } = require("./scraper"); // Impor fungsi dari scraper.js

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware untuk parsing JSON (opsional, tapi praktik yang baik)
app.use(express.json());

// Route utama untuk memberikan pesan sambutan
app.get("/", (req, res) => {
  res.send(
    "Selamat datang di API Scraper Lelang. Gunakan endpoint /api/lelang."
  );
});

// Endpoint utama untuk mengambil data lelang
app.get("/api/lelang", async (req, res) => {
  // Ambil parameter dari query string URL
  // contoh: /api/lelang?tahun=2024&page=1&limit=5
  const { tahun, page, limit } = req.query;

  // --- Validasi Input ---
  if (!tahun) {
    return res.status(400).json({
      success: false,
      error: 'Parameter "tahun" wajib diisi.',
    });
  }

  const year = parseInt(tahun, 10);
  const pageNumber = parseInt(page, 10) || 1; // Default ke halaman 1 jika tidak ada
  const pageSize = parseInt(limit, 10) || 10; // Default ke 10 item per halaman jika tidak ada

  if (isNaN(year) || year < 2000 || year > 2050) {
    return res.status(400).json({
      success: false,
      error: 'Parameter "tahun" tidak valid.',
    });
  }

  console.log(
    `Menerima permintaan untuk tahun: ${year}, halaman: ${pageNumber}, limit: ${pageSize}`
  );

  try {
    // Panggil fungsi scraper dengan parameter yang sudah divalidasi
    const result = await fetchTenderData(year, pageNumber, pageSize);

    // Jika scraper gagal, kirim respons error
    if (!result.success) {
      // Kirim status 500 (Internal Server Error) karena masalah ada di sisi server/scraper
      return res.status(500).json(result);
    }

    // Jika berhasil, kirim data dengan status 200 (OK)
    res.status(200).json(result);
  } catch (error) {
    // Tangani error tak terduga lainnya
    console.error("Error di endpoint API:", error);
    res.status(500).json({
      success: false,
      error: "Terjadi kesalahan internal pada server.",
    });
  }
});

// Jalankan server hanya jika file ini dijalankan secara langsung (untuk development lokal)
// Jalankan server hanya jika file ini dijalankan secara langsung (untuk development lokal)
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`🚀 Server berjalan di http://localhost:${PORT}`);
  });
}

// Ekspor aplikasi Express agar Vercel dapat menggunakannya sebagai serverless function
module.exports = app;
