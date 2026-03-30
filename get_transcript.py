import sys
sys.stdout.reconfigure(encoding='utf-8')
import json
from youtube_transcript_api import YouTubeTranscriptApi, NoTranscriptFound, TranscriptsDisabled
#import youtube_transcript_api
#print(f"DEBUG: Library path is {youtube_transcript_api.__file__}")
#print(f"DEBUG: Available attributes: {dir(youtube_transcript_api.YouTubeTranscriptApi)}")

def get_youtube_transcript(video_id, preferred_language='zh-Hans'):
    # 定义一个语言偏好列表，按顺序查找
    preferred_languages = [preferred_language,'zh-TW', 'zh-HK', 'zh-CN', 'zh-Hans', 'zh-Hant', 'zh', 'en']

    try:
        # 1. 根据 README，实例化 API 并获取可用字幕列表
        api = YouTubeTranscriptApi()
        transcript_list = api.list(video_id)

        transcript = None
        # 2. 优先查找人工创建的字幕（通常更准确）
        try:
            transcript = transcript_list.find_manually_created_transcript(preferred_languages)
        except NoTranscriptFound:
            # 3. 如果找不到，再回退查找自动生成的字幕
            try:
                transcript = transcript_list.find_generated_transcript(preferred_languages)
            except NoTranscriptFound:
                # 如果两种都找不到，则确定没有可用字幕
                return None

        # 4. 获取并拼接字幕文本
        # 返回包含时间戳的完整字幕数据列表
        return transcript.fetch().to_raw_data()

    except (NoTranscriptFound, TranscriptsDisabled):
        # 这个顶层异常处理视频本身没有任何字幕或字幕被禁用的情况
        return None
    except Exception as e:
        # 捕获所有其他意外错误
        print(f"Error fetching transcript for {video_id}: {e}", file=sys.stderr)
        return None

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python get_transcript.py <video_id>", file=sys.stderr)
        sys.exit(1)

    video_id = sys.argv[1]
    transcript_text = get_youtube_transcript(video_id)
    
    if transcript_text is not None:
        # 将结果以 JSON 格式打印到标准输出，方便 Node.js 解析
        print(json.dumps({"transcript": transcript_text},ensure_ascii=False))
    else:
        # 如果没有找到字幕，打印一个空 JSON 或错误信息
        print(json.dumps({"transcript": None}))
