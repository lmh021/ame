/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface SongMetadata {
  songName: string;
  artistName: string;
  cleanUrl: string;
  method?: string;
}

export interface SpreadsheetRow {
  rowNum: number;
  songName: string;
  artistName: string;
  cleanUrl: string;
}

export interface AuthState {
  user: any | null;
  accessToken: string | null;
  needsAuth: boolean;
}

export interface AppleMusicMetadata {
  songName: string;
  artistName: string;
  cleanUrl: string;
}

export interface GoogleSheetFile {
  id: string;
  name: string;
  mimeType: string;
}

export interface SheetRow {
  songName: string;
  artistName: string;
  cleanUrl: string;
  rowNumber: number;
}
