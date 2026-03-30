// server.js
const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const { v4: uuidv4 } = require('uuid');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const OpenAI = require('openai');
require('dotenv').config();

// 音频处理依赖
const ytdl = require('yt-dlp-exec');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const ffprobePath = require('@ffprobe-installer/ffprobe').path;
const fsPromises = require('fs/promises');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

// 配置 ffmpeg 路径
ffmpeg.setFfmpegPath(ffmpegPath);
ffmpeg.setFfprobePath(ffprobePath);


const app = express();
const port = 3000;

app.use(cors());
app.use(express.json());

// --- Database Setup ---
const dbPath = path.join(__dirname, 'db.sqlite');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error opening database', err.message);
    } else {
        console.log('Connected to the SQLite database.');
        db.run(`CREATE TABLE IF NOT EXISTS summaries (
            video_id TEXT PRIMARY KEY,
            summary TEXT NOT NULL,
            created_at TEXT NOT NULL
        )`, (err) => {
            if (err) {
                console.error('Error creating table', err.message);
            } else {
                console.log('Table "summaries" is ready.');
            }
        });
    }
});

// Promise-based wrappers for DB operations
function dbGet(query, params) {
    return new Promise((resolve, reject) => {
        db.get(query, params, (err, row) => {
            if (err) return reject(err);
            resolve(row);
        });
    });
}

function dbRun(query, params) {
    return new Promise((resolve, reject) => {
        db.run(query, params, function (err) {
            if (err) return reject(err);
            resolve(this);
        });
    });
}


// --- AI Clients Initialization ---

// Gemini for Summarization
if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is not set in .env file");
}
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const summaryModel = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" });

// OpenAI for Transcription
if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not set in .env file");
}
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});


const tasks = new Map(); // 用于存储异步任务状态的内存数据库

// --- 辅助函数 ---

/**
 * 格式化秒数为 [HH:MM:SS] 格式
 * @param {number} seconds - 总秒数
 * @returns {string} 格式化后的时间字符串
 */
function formatTime(seconds) {
    const h = Math.floor(seconds / 3600).toString().padStart(2, '0');
    const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
    const s = Math.floor(seconds % 60).toString().padStart(2, '0');
    return `${h}:${m}:${s}`;
}

/**
 * 将带时间戳的字幕数据格式化为单个字符串
 * @param {Array<object>} transcriptData - 字幕数据数组, e.g., [{start: 0.5, text: "Hello"}]
 * @returns {string} 格式化后的字幕字符串
 */
function formatTranscriptWithTimestamps(transcriptData) {
    return transcriptData.map(entry => `[${formatTime(entry.start)}] ${entry.text}`).join('\n');
}

/**
 * 从 YouTube URL 中提取视频 ID
 * @param {string} url - YouTube URL.
 * @returns {string|null} 视频 ID 或 null.
 */
function getVideoId(url) {
    try {
        const urlObj = new URL(url);
        if (urlObj.hostname === 'youtu.be') {
            return urlObj.pathname.slice(1);
        }
        if (urlObj.hostname.includes('youtube.com')) {
            return urlObj.searchParams.get('v');
        }
        return null;
    } catch (error) {
        console.error('无效的 URL:', url, error);
        return null;
    }
}

/**
 * 使用 Gemini Pro 总结给定的文本
 * @param {string} text - 需要总结的文本.
 * @returns {Promise<string>} 总结内容.
 */
async function summarizeText(text) {
    const prompt = `请用繁体中文，根据以下内容总结出 5-10 个关键要点，并以项目符号列表（bullet points）的形式呈现。如果内容中包含时间戳（例如 [HH:MM:SS]），请在对应的要点后附上时间戳范围，以帮助定位。\n\n内容:\n"""\n${text}\n"""\n\n摘要:`;
    const result = await summaryModel.generateContent(prompt);
    return result.response.text();
}

// --- API 端点 ---

app.post('/summarize', (req, res) => {
    const { videoUrl } = req.body;
    if (!videoUrl) {
        return res.status(400).json({ error: 'videoUrl is required.' });
    }

    const videoId = getVideoId(videoUrl);
    if (!videoId) {
        return res.status(400).json({ error: 'Invalid or unsupported YouTube URL' });
    }

    const taskId = uuidv4();
    tasks.set(taskId, { status: 'processing', data: null });

    res.status(202).json({ taskId });

    processVideo(videoUrl, videoId, taskId);
});

app.get('/status/:taskId', (req, res) => {
    const { taskId } = req.params;
    const task = tasks.get(taskId);

    if (!task) {
        return res.status(404).json({ error: 'Task not found.' });
    }

    res.json(task);
});

async function processVideo(videoUrl, videoId, taskId) {
    console.log(`[${videoId}] 开始处理请求...`);
    try {
        const cached = await dbGet("SELECT summary FROM summaries WHERE video_id = ?", [videoId]);
        if (cached && cached.summary) {
            console.log(`[${videoId}] 找到缓存的摘要。`);
            tasks.set(taskId, { status: 'complete', data: { summary: cached.summary, source: 'cache' } });
            return;
        }
        console.log(`[${videoId}] 未找到缓存，开始实时处理...`);

        const pythonExecutable = process.platform === 'win32'
            ? path.join(__dirname, '.venv', 'Scripts', 'python.exe')
            : path.join(__dirname, '.venv', 'bin', 'python');
        const transcriptScriptPath = path.join(__dirname, 'get_transcript.py');

        const pythonProcess = spawn(pythonExecutable, [transcriptScriptPath, videoId]);

        let transcriptData = '';
        let errorData = '';
        pythonProcess.stdout.on('data', (data) => { transcriptData += data.toString(); });
        pythonProcess.stderr.on('data', (data) => { errorData += data.toString(); });

        pythonProcess.on('close', async (code) => {
            if (code !== 0) {
                const errorMsg = `执行字幕脚本失败: ${errorData}`;
                console.error(`[${videoId}] Python 脚本执行失败，代码 ${code}: ${errorMsg}`);
                // Fallback to audio processing if script fails
                console.log(`[${videoId}] 字幕脚本失败，转而使用音频处理...`);
                try {
                    const summary = await handleAudioProcessing(videoUrl, videoId);
                    await dbRun("INSERT INTO summaries (video_id, summary, created_at) VALUES (?, ?, ?)", [videoId, summary, new Date().toISOString()]);
                    tasks.set(taskId, { status: 'complete', data: { summary } });
                } catch (audioError) {
                    console.error(`[${videoId}] 音频处理也失败了:`, audioError);
                    tasks.set(taskId, { status: 'error', data: { error: `字幕和音频处理均失败: ${audioError.message}` } });
                }
                return;
            }

            try {
                const { transcript } = JSON.parse(transcriptData);
                let summary;

                if (transcript && Array.isArray(transcript) && transcript.length > 0) {
                    console.log(`[${videoId}] 找到带时间戳的字幕，正在格式化并总结...`);
                    const formattedTranscript = formatTranscriptWithTimestamps(transcript);
                    summary = await summarizeText(formattedTranscript);
                } else {
                    console.log(`[${videoId}] 未找到字幕，启动音频转文字流程。`);
                    summary = await handleAudioProcessing(videoUrl, videoId);
                }
                
                await dbRun("INSERT INTO summaries (video_id, summary, created_at) VALUES (?, ?, ?)", [videoId, summary, new Date().toISOString()]);
                console.log(`[${videoId}] 缓存成功。`);
                tasks.set(taskId, { status: 'complete', data: { summary } });

            } catch (error) {
                console.error(`[${videoId}] 总结或音频处理流程出错:`, error);
                tasks.set(taskId, { status: 'error', data: { error: `服务器内部错误: ${error.message}` } });
            }
        });
    } catch (error) {
        console.error(`[${videoId}] 处理请求时出错:`, error);
        tasks.set(taskId, { status: 'error', data: { error: `服务器内部错误: ${error.message}` } });
    }
}


// --- 音频处理逻辑 (Whisper API) ---

/**
 * 处理完整的音频流程：下载、切块、使用 Whisper 转写、总结
 * @param {string} videoUrl - 完整的 YouTube 视频 URL.
 * @param {string} videoId - 视频 ID.
 * @returns {Promise<string>} 总结内容.
 */
async function handleAudioProcessing(videoUrl, videoId) {
    const tempDir = path.join(__dirname, 'temp', videoId);
    const audioPath = path.join(tempDir, 'audio.mp3');

    try {
        await fsPromises.mkdir(tempDir, { recursive: true });

        console.log(`[${videoId}] 正在下载音频...`);
        await ytdl(videoUrl, {
            extractAudio: true,
            audioFormat: 'mp3',
            output: audioPath,
        });
        console.log(`[${videoId}] 音频已下载至 ${audioPath}`);

        const getDuration = (filePath) => new Promise((resolve, reject) => {
            ffmpeg.ffprobe(filePath, (err, metadata) => {
                if (err) return reject(err);
                resolve(metadata.format.duration);
            });
        });

        const duration = await getDuration(audioPath);
        console.log(`[${videoId}] 音频时长: ${Math.round(duration)} 秒。`);

        const chunkDuration = 540; // 9 分钟
        const chunkPaths = [];

        if (duration > chunkDuration) {
            console.log(`[${videoId}] 音频较长，正在准备并行切块...`);
            const chunkPromises = [];
            for (let i = 0; i < duration; i += chunkDuration) {
                const chunkIndex = Math.floor(i / chunkDuration);
                const chunkPath = path.join(tempDir, `chunk_${chunkIndex}.mp3`);
                chunkPaths.push(chunkPath);

                const chunkPromise = new Promise((resolve, reject) => {
                    ffmpeg(audioPath)
                        .setStartTime(i)
                        .setDuration(chunkDuration)
                        .output(chunkPath)
                        .on('end', () => {
                            console.log(`[${videoId}] 已创建分块 ${chunkIndex}。`);
                            resolve(chunkPath);
                        })
                        .on('error', (err) => {
                            console.error(`[${videoId}] 创建分块 ${chunkIndex} 时出错: ${err.message}`);
                            reject(err);
                        })
                        .run();
                });
                chunkPromises.push(chunkPromise);
            }
            await Promise.all(chunkPromises);
        } else {
            chunkPaths.push(audioPath);
        }

        console.log(`[${videoId}] 正在使用 Whisper API 转写 ${chunkPaths.length} 个音频分块...`);
        const transcriptionPromises = chunkPaths.map((chunkPath, index) => {
            return openai.audio.transcriptions.create({
                file: fs.createReadStream(chunkPath),
                model: "whisper-1",
                response_format: "verbose_json",
                // language: 'zh', // 可选，指定语言
                prompt: "这是一个 YouTube 视频的音频，请准确转写。内容可能包含技术术语、中英文混合等。",
            }).then(response => {
                console.log(`[${videoId}] 分块 ${index} 转写完成。`);
                return { response, chunkIndex: index };
            });
        });

        const chunkResponses = await Promise.all(transcriptionPromises);
        
        let allSegments = [];
        for (const { response, chunkIndex } of chunkResponses) {
            const timeOffset = chunkIndex * chunkDuration;
            const segments = response.segments.map(segment => ({
                start: timeOffset + segment.start,
                text: segment.text,
            }));
            allSegments.push(...segments);
        }
        
        if (allSegments.length === 0) {
            throw new Error("Whisper API 转写结果为空。");
        }

        const fullTranscript = formatTranscriptWithTimestamps(allSegments);
        console.log(`[${videoId}] 已从音频生成带时间戳的完整文稿。`);

        console.log(`[${videoId}] 正在总结生成的文稿...`);
        const summary = await summarizeText(fullTranscript);
        console.log(`[${videoId}] 已从音频成功生成总结。`);
        return summary;

    } catch (err) {
        console.error(`[${videoId}] 音频处理流程出错:`, err.message, err.stack);
        throw new Error(`处理视频音频失败: ${err.message}`);
    } finally {
        console.log(`[${videoId}] 正在清理临时文件...`);
        try {
            await fsPromises.rm(tempDir, { recursive: true, force: true });
            console.log(`[${videoId}] 临时目录已清理。`);
        } catch (cleanupError) {
            console.error(`[${videoId}] 清理临时文件时出错:`, cleanupError);
        }
    }
}

app.listen(port, () => {
    console.log(`服务器正在 http://localhost:${port} 监听...`);
});