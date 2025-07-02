import { GoogleGenerativeAI } from '@google/generative-ai';

export class MidjourneyService {
  private genAI: GoogleGenerativeAI;

  constructor(apiKey: string) {
    this.genAI = new GoogleGenerativeAI(apiKey);
    console.log('🎨 MidjourneyService 初期化完了');
  }

  /**
   * 日本語テキストを創造的な英語プロンプトに変換
   */
  async generateCreativePrompt(japaneseText: string): Promise<string> {
    try {
      const model = this.genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
      
      const prompt = `以下の日本語の文章を、Midjourneyで美しく創造的な画像を生成するための英語プロンプトに変換してください。
視覚的で詩的な表現を使い、情景が豊かに伝わるようにしてください。

日本語: ${japaneseText}

要件:
- 創造的で視覚的な英語表現
- 色彩、光、雰囲気の詳細を含める
- Midjourneyが理解しやすい形式
- プロンプトのみを返す（説明文は不要）
- cinematic, artistic, professionalなどの修飾語を適切に使用`;

      const result = await model.generateContent(prompt);
      const response = await result.response;
      return response.text().trim();
      
    } catch (error) {
      console.error('プロンプト生成エラー:', error);
      throw new Error('プロンプトの生成に失敗しました');
    }
  }
}