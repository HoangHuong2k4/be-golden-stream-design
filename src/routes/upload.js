import { Hono } from 'hono';
import { authMiddleware, adminMiddleware } from '../middleware/auth.js';
import fs from 'node:fs';
import path from 'node:path';

const upload = new Hono();

/**
 * POST /api/admin/upload
 * Upload ảnh lên thư mục assets/uploads của Frontend
 */
upload.post('/', authMiddleware, adminMiddleware, async (c) => {
  try {
    const body = await c.req.parseBody();
    const file = body['file'];

    if (!file || !(file instanceof File)) {
      return c.json({ error: 'Vui lòng chọn file hợp lệ' }, 400);
    }

    // Đường dẫn tuyệt đối tới thư mục uploads của FE
    const uploadDir = path.resolve(process.cwd(), '../assets/uploads');
    
    // Tạo thư mục nếu chưa tồn tại
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    // Tạo tên file duy nhất (timestamp + tên gốc)
    const originalName = file.name.replace(/\s+/g, '_');
    const fileName = `${Date.now()}-${originalName}`;
    const filePath = path.join(uploadDir, fileName);

    // Ghi file
    const arrayBuffer = await file.arrayBuffer();
    fs.writeFileSync(filePath, Buffer.from(arrayBuffer));

    // Trả về URL tương đối để FE sử dụng
    return c.json({
      success: true,
      url: `/assets/uploads/${fileName}`,
      fileName
    });
  } catch (error) {
    console.error('[Upload Error]', error);
    return c.json({ error: 'Lỗi trong quá trình upload file: ' + error.message }, 500);
  }
});

export default upload;
