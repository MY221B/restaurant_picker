/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './index.html', // 添加 HTML 文件路径
    './styles.css', // 添加 CSS 文件路径
    './script.js',  // 添加 JS 文件路径
    './src/**/*.{vue,js,ts,jsx,tsx}',
    './*.{vue,js,ts,jsx,tsx}'
    // 其他模板文件路径...
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}

