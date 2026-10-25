# Chấm Điểm AI

Web app hỗ trợ giáo viên chấm bài bằng AI, duyệt và chốt điểm, ghi vào sổ điểm lớp, xuất file theo mẫu **FSP** (của trường) và **CSDL** (của Sở), rồi **đối chiếu điểm FSP ↔ CSDL** trước khi vào điểm trên hệ thống thật.

## Các trang

| Trang | Việc làm được |
|---|---|
| **Chấm bài** | Nhập đề, tiêu chí, yêu cầu chấm và danh sách lớp, rồi chọn thư mục bài làm. Hệ thống báo những gì đã nhận và các bất thường (thiếu bài, file không ghép được, tổng điểm khác 10…). AI chấm mỗi bài 2 lượt (chấm, rồi tự rà soát), sau đó hệ thống tự kiểm tra lại. Bạn duyệt từng bài: chỗ sai được **bôi đỏ** ngay trong bài làm, điểm bạn sửa hiện **màu cam**, mỗi bài có ô ☑ “Đã xem”. Xem hết danh sách thì nút **Chốt điểm** mới bật. |
| **Sổ điểm lớp & điểm TX** | Mỗi lớp có cột TX1, TX2, GK, CK cho HK I và HK II. Điểm chấm bằng AI được ghi vào đây khi chốt (thang 10, 1 chữ số thập phân). Điểm TX có thể **dán từ Excel**: dán cột “Họ tên + Điểm” (ghép theo tên/mã), hoặc chỉ cột điểm (theo thứ tự). Cũng có thể bấm vào ô đầu rồi Ctrl+V cả cột. |
| **Xuất FSP / CSDL** | Đầu tiên chọn **giai đoạn**: Giữa kì (nhập TX1 + GK) hoặc Cuối kì (TX2 + CK). Tải lên file mẫu FSP (một lớp, hoặc **cả khối mỗi lớp một sheet**) hay file CSDL của lớp. Hệ thống tự dò dòng tiêu đề và các cột; bạn sửa bằng menu chọn nếu dò sai. Trang báo những gì đã nhận và các bất thường, cho xem trước từng ô (điểm hiện có → điểm mới). Khi tạo file, hệ thống **mở lại file vừa tạo và kiểm tra từng ô** trước khi cho tải về. Định dạng, ô gộp, công thức trong file mẫu được giữ nguyên. |
| **Đối chiếu FSP ↔ CSDL** | Tải lên file FSP (nhiều sheet) và các file CSDL. Hệ thống ghép từng lớp, từng học sinh (theo mã HS, rồi theo họ tên). Kết quả gồm số điểm đúng/sai, tỉ lệ sai theo lớp và theo cột, và danh sách sai lệch (lệch điểm / thiếu ở một bên). Có thể tải báo cáo Excel. |

**Định dạng bài làm đọc được:** Word (.docx), PowerPoint (.pptx), PDF (kể cả bản scan, AI đọc bằng hình), ảnh chụp, Scratch (.sb3), Python (.py) và các file mã/văn bản khác, Excel (.xlsx).
Với bài làm dạng ảnh/PDF scan, lỗi được liệt kê ở cột bên phải, không bôi đỏ trên hình.

**File Excel mẫu:** .xlsx và .xls. File .xls cần Internet để tải thư viện đọc; file xuất ra vẫn là .xls nhưng có thể mất một phần màu/viền.

## Dữ liệu lưu ở đâu?

Mọi bài chấm và sổ điểm được lưu **trong trình duyệt trên máy bạn** (IndexedDB), không lên máy chủ.
Máy chủ chỉ chuyển bài làm sang AI để chấm. Muốn chuyển sang máy khác, hoặc để phòng mất dữ liệu: ở trang **Chấm bài**, bấm **Sao lưu** (tải file .json), rồi **Khôi phục** trên máy kia.

## Deploy lên Vercel (khuyên dùng)

1. Đưa thư mục này lên GitHub (repo riêng tư).
2. Vào vercel.com → **Add New → Project** → chọn repo. Vercel tự đọc `vercel.json` (build `node build.mjs`, thư mục `dist`, hàm API trong `api/`).
3. Vào **Settings → Environment Variables** và thêm:

| Biến | Ý nghĩa |
|---|---|
| `OPENAI_API_KEY` *hoặc* `ANTHROPIC_API_KEY` | Khóa API của AI chấm bài (chọn một trong hai) |
| `AI_PROVIDER` | (tuỳ chọn) `openai` hoặc `anthropic` khi đặt cả hai khóa |
| `OPENAI_MODEL` / `ANTHROPIC_MODEL` | (tuỳ chọn) mặc định `gpt-4o` / `claude-sonnet-5-5` |
| `APP_PASSWORD` | **Nên đặt.** Mật khẩu vào app, để người khác có link cũng không dùng được khóa API của bạn |

4. Thêm biến xong thì bấm **Redeploy**.

## Deploy lên Render

Tạo **Web Service** từ repo GitHub với các thiết lập:
- Build Command: `npm install && npm run build`
- Start Command: `npm start`
- Environment: các biến như bảng trên.

## Chạy thử trên máy

```bash
npm install
npm run mock      # chạy không cần khóa API: AI trả kết quả giả lập để thử giao diện
# hoặc chạy thật:
OPENAI_API_KEY=sk-... npm run dev
```

Sau đó mở http://localhost:5173.

## Gợi ý quy trình mỗi đợt kiểm tra

1. **Sổ điểm lớp:** thêm các lớp (tải file danh sách / bảng điểm lớp), rồi dán điểm TX1 (hoặc TX2).
2. **Chấm bài:** tạo bài chấm, chọn học kì và cột (GK/CK), lấy danh sách từ sổ điểm lớp, nhập đề và tiêu chí, viết yêu cầu chấm, chọn thư mục bài. Tiếp theo xác nhận, bấm *Chấm thử 2 bài* để xem AI chấm có đúng ý không, rồi chấm cả lớp. Duyệt, tích ô “Đã xem” và bấm *Chốt điểm*. Điểm tự vào sổ.
3. **Xuất file:** file Word (trang 1: tiêu chí; trang 2: bảng điểm từng tiêu chí và tổng), FSP và CSDL.
4. **Đối chiếu FSP ↔ CSDL** trước khi vào điểm trên hệ thống thật.

> AI có thể chấm sai. Điểm chỉ là bản nháp cho tới khi giáo viên xem và chốt.
