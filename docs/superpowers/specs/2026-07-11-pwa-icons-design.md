# PWA 安装图标设计

## 目标

补齐主流浏览器和操作系统要求的标准 PWA 图标尺寸，避免安装入口缺失、低分辨率图标或 maskable 裁切异常。

## 资产

- 保留 `app-icon.svg` 作为可缩放浏览器图标和品牌源文件。
- 生成 `app-icon-192.png` 与 `app-icon-512.png`，用于标准安装图标。
- 生成 `app-icon-180.png`，用于 Apple Touch Icon。
- 新增 `app-icon-maskable.svg` 作为 maskable 源文件，使用满幅品牌背景并将主要图形保持在中央安全区。
- 生成 `app-icon-maskable-512.png`，只声明 `purpose=maskable`。

## 清单与缓存

- SVG 使用 `sizes=any`、`purpose=any`。
- 192 与 512 PNG 使用 `purpose=any`。
- maskable PNG 单独使用 `purpose=maskable`，不混合声明。
- HTML 增加 Apple Touch Icon，所有 PNG 加入 PWA 应用外壳缓存。

## 验证

- 自动化测试读取 PNG IHDR，确认实际像素尺寸与文件名一致。
- 验证清单包含 192、512 和独立 maskable 图标声明。
- 验证图标响应类型和离线缓存清单，并继续运行完整浏览器回归。
