import { google } from 'googleapis';
import { GoogleAuth } from 'google-auth-library';
import fetch from 'node-fetch';
import * as fs from 'fs';
import * as path from 'path';

export class GoogleDriveService {
  private drive: any;
  private auth: GoogleAuth;
  private folderId: string;

  constructor() {
    // Google Drive フォルダID (URLから抽出)
    this.folderId = '1hlgcrDf_4hLJpemYfadP5zZ3PTrxSR2t';
    
    // 認証設定
    this.auth = new google.auth.GoogleAuth({
      keyFile: process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE,
      scopes: [
        'https://www.googleapis.com/auth/drive.file',
        'https://www.googleapis.com/auth/drive'
      ],
    });

    console.log('📁 GoogleDriveService 初期化完了');
  }

  /**
   * Google Drive APIクライアントを初期化
   */
  private async initializeDrive() {
    if (!this.drive) {
      const authClient = await this.auth.getClient();
      this.drive = google.drive({ version: 'v3', auth: authClient as any });
    }
    return this.drive;
  }

  /**
   * URLから画像をダウンロードしてGoogle Driveにアップロード
   */
  async uploadImageFromUrl(imageUrl: string, fileName: string): Promise<string> {
    try {
      console.log(`📥 画像をダウンロード中: ${imageUrl}`);
      
      // 画像をダウンロード
      const response = await fetch(imageUrl);
      if (!response.ok) {
        throw new Error(`画像のダウンロードに失敗: ${response.statusText}`);
      }

      const imageBuffer = await response.buffer();
      const mimeType = response.headers.get('content-type') || 'image/jpeg';
      
      // 一時ファイルに保存
      const tempDir = './temp';
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }
      
      const tempFilePath = path.join(tempDir, fileName);
      fs.writeFileSync(tempFilePath, imageBuffer);

      console.log(`☁️ Google Driveにアップロード中: ${fileName}`);
      
      // Google Driveにアップロード
      const drive = await this.initializeDrive();
      const fileMetadata = {
        name: fileName,
        parents: [this.folderId]
      };

      const media = {
        mimeType: mimeType,
        body: fs.createReadStream(tempFilePath)
      };

      const file = await drive.files.create({
        requestBody: fileMetadata,
        media: media,
        fields: 'id,name,webViewLink'
      });

      // 一時ファイルを削除
      fs.unlinkSync(tempFilePath);

      console.log(`✅ アップロード完了: ${file.data.name}`);
      console.log(`🔗 Google Drive URL: ${file.data.webViewLink}`);
      
      return file.data.webViewLink;

    } catch (error) {
      console.error('❌ Google Driveアップロードエラー:', error);
      throw error;
    }
  }

  /**
   * ファイル名を生成（タイムスタンプ + プロンプト情報）
   */
  generateFileName(originalPrompt: string, aspectRatio: string): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const promptSnippet = originalPrompt
      .replace(/https?:\/\/[^\s]+/g, '') // URLを除去
      .replace(/--\w+\s+[^\s]+/g, '') // パラメータを除去
      .trim()
      .substring(0, 50) // 最初の50文字
      .replace(/[^a-zA-Z0-9\s]/g, '') // 特殊文字を除去
      .replace(/\s+/g, '_'); // スペースをアンダースコアに

    return `midjourney_${timestamp}_${aspectRatio.replace(':', 'x')}_${promptSnippet}.jpg`;
  }

  /**
   * サービスの設定状況を確認
   */
  checkConfiguration(): { configured: boolean; message: string } {
    if (!process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE) {
      return {
        configured: false,
        message: 'GOOGLE_SERVICE_ACCOUNT_KEY_FILE環境変数が設定されていません'
      };
    }

    if (!fs.existsSync(process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE)) {
      return {
        configured: false,
        message: 'サービスアカウントキーファイルが見つかりません'
      };
    }

    return {
      configured: true,
      message: 'Google Drive連携が正常に設定されています'
    };
  }
} 