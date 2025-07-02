import { EmbedBuilder } from 'discord.js';
import { GoogleGenerativeAI } from '@google/generative-ai';

export class MidjourneyService {
  private styleRefUrl: string;
  private genAI: GoogleGenerativeAI;
  
  constructor() {
    // スタイル画像のURL（環境変数から取得）
    this.styleRefUrl = process.env.MIDJOURNEY_SREF_URL || '';
    
    // Gemini APIを初期化
    this.genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY!);
    
    console.log('🎨 MidjourneyService 初期化完了');
  }
  
  /**
   * 画像用のプロンプト生成
   * @param imageUrl 画像のURL
   * @param aspectRatio アスペクト比（例：16:9）
   */
  generatePrompt(imageUrl: string, aspectRatio: string = '16:9'): string {
    let prompt = `${imageUrl} cinematic photography, golden hour lighting, professional quality`;
    
    // スタイルリファレンスがあれば追加
    if (this.styleRefUrl) {
      prompt += ` --sref ${this.styleRefUrl}`;
    }
    
    // アスペクト比を追加
    prompt += ` --ar ${aspectRatio}`;
    
    return prompt;
  }
  
  /**
   * テキスト用のプロンプト生成（英語プロンプトから）
   * @param englishPrompt 英語のプロンプト
   * @param aspectRatio アスペクト比
   */
  generateTextPrompt(englishPrompt: string, aspectRatio: string = '16:9'): string {
    let prompt = englishPrompt;
    
    // スタイルリファレンスがあれば追加
    if (this.styleRefUrl) {
      prompt += ` --sref ${this.styleRefUrl}`;
    }
    
    // アスペクト比を追加
    prompt += ` --ar ${aspectRatio}`;
    
    return prompt;
  }
  
  /**
   * 日本語テキストから英語の画像生成プロンプトを作成
   * @param japaneseText 日本語の説明文
   */
  async generateCreativePrompt(japaneseText: string): Promise<string> {
    try {
      const model = this.genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
      
      const prompt = `
あなたは創造的な画像生成プロンプトの専門家です。
以下の日本語の文章を元に、Midjourneyで美しい画像を生成するための
詳細で情景豊かな英語プロンプトを作成してください。

要件：
1. 視覚的な詳細を豊富に含める（色、光、質感、雰囲気）
2. 30-50単語程度の簡潔で効果的なプロンプト
3. アーティスティックなスタイルを含める（例：cinematic, ethereal, dramatic等）
4. 具体的な構図や視点の指定も含める

日本語の説明：
${japaneseText}

英語プロンプトのみを出力してください。説明や装飾は不要です。`;

      const result = await model.generateContent(prompt);
      const response = result.response.text().trim();
      
      // 余計な記号や改行を除去
      return response
        .replace(/["\n]/g, ' ')
        .replace(/\s+/g, ' ')
        .replace(/^\*+|\*+$/g, '') // アスタリスクを除去
        .trim();
      
    } catch (error) {
      console.error('プロンプト生成エラー:', error);
      // フォールバック
      return 'beautiful landscape with dramatic lighting, cinematic atmosphere, highly detailed';
    }
  }
  
  /**
   * プロンプト表示用のEmbedを作成
   */
  createPromptEmbed(prompt: string): EmbedBuilder {
    return new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('🎨 Midjourneyプロンプト')
      .setDescription('以下のプロンプトをコピーしてMidjourneyで使用してください')
      .addFields({
        name: '📋 プロンプト',
        value: `\`\`\`${prompt}\`\`\``
      })
      .addFields({
        name: '💡 使い方',
        value: '1. 上記のプロンプトをコピー\n2. Midjourneyチャンネルで `/imagine` と入力\n3. プロンプトを貼り付けて送信'
      })
      .setFooter({ text: 'プロンプトをコピーしてMidjourneyチャンネルで使用' })
      .setTimestamp();
  }
}