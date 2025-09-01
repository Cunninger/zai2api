# 使用官方Node.js运行时作为基础镜像
FROM node:18-alpine

# 设置工作目录
WORKDIR /app

# 复制package.json和package-lock.json（如果存在）
COPY package*.json ./

# 安装依赖
RUN npm ci --only=production

# 复制应用程序代码
COPY . .

# 暴露端口
EXPOSE 5566

# 设置环境变量
ENV NODE_ENV=production
ENV PORT=5566

# 可配置的环境变量（在运行时通过 -e 参数设置）
# ENV DEFAULT_KEY=sk-your-key
# ENV UPSTREAM_TOKEN=
# ENV DEBUG_MODE=true
# ENV ANON_TOKEN_ENABLED=true

# 启动应用程序
CMD ["npm", "start"]