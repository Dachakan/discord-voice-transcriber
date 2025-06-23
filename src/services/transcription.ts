import { GoogleGenerativeAI } from '@google/generative-ai';
import fetch from 'node-fetch';
import * as fs from 'fs';
import * as path from 'path';

export class TranscriptionService {
    private genAI: GoogleGenerativeAI;
    private model: any;

    constructor() {
        const apiKey = process.env.GOOGLE_AI_API_KEY;
        if (!apiKey) {
            throw new Error('GOOGLE_AI_API_KEY が設定されていません');
        }
        
        this.genAI = new GoogleGenerativeAI(apiKey);
        this.model = this.genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        
        console.log('🎤 TranscriptionService 初期化完了');
    }

    // 音声ファイルをダウンロード
    private async downloadAudioFile(url: string): Promise<Buffer> {
        console.log('📥 音声ファイルをダウンロード中:', url);
        
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`ダウンロード失敗: ${response.statusText}`);
        }
        
        const buffer = Buffer.from(await response.arrayBuffer());
        console.log('✅ ダウンロード完了:', buffer.length, 'bytes');
        
        return buffer;
    }

    // BufferをBase64に変換
    private bufferToBase64(buffer: Buffer): string {
        return buffer.toString('base64');
    }

    // 音声ファイルを文字起こし
    async transcribeAudio(audioUrl: string, mimeType: string = 'audio/ogg'): Promise<string> {
        try {
            console.log('🎙️ 文字起こし開始...');
            
            // 音声ファイルをダウンロード
            const audioBuffer = await this.downloadAudioFile(audioUrl);
            const audioBase64 = this.bufferToBase64(audioBuffer);

            // Gemini APIに送信
            const prompt = `
この音声を日本語で文字起こししてください。
以下の点に注意してください：
- 句読点を適切に付ける
- 「えー」「あのー」などの不要なフィラーは除去する
- 話し言葉を自然な文章に整える
- もし音声が聞き取れない場合は「[聞き取り不能]」と記載する
`;

            // 音声データを含めてAPIリクエスト
            const result = await this.model.generateContent([
                prompt,
                {
                    inlineData: {
                        mimeType: mimeType,
                        data: audioBase64
                    }
                }
            ]);

            const response = await result.response;
            const transcription = response.text().trim();
            
            console.log('✅ 文字起こし完了');
            console.log('📝 文字数:', transcription.length);
            
            return transcription;
            
        } catch (error) {
            console.error('❌ 文字起こしエラー:', error);
            throw error;
        }
    }

    // テスト用：APIが正常に動作するか確認
    async testAPI(): Promise<boolean> {
        try {
            const result = await this.model.generateContent("こんにちは。これはテストです。");
            const response = await result.response;
            console.log('✅ Gemini API テスト成功:', response.text());
            return true;
        } catch (error) {
            console.error('❌ Gemini API テスト失敗:', error);
            return false;
        }
    }
}