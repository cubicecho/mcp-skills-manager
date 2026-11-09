import {
  BookMarked as BookMarkedSource,
  FileArchive as FileArchiveSource,
  FilePlus as FilePlusSource,
  FolderPlus as FolderPlusSource,
  FolderUp as FolderUpSource,
  Save as SaveSource,
  Unlink as UnlinkSource,
} from 'lucide-react';
import { icon } from '@/components/ui/icons';

/** The glyphs this app needs that the cubeui icon set (`ui/icons`) does not ship. */
export const BookMarked = icon(BookMarkedSource);
export const FileArchive = icon(FileArchiveSource);
export const FilePlus = icon(FilePlusSource);
export const FolderPlus = icon(FolderPlusSource);
export const FolderUp = icon(FolderUpSource);
export const Save = icon(SaveSource);
export const Unlink = icon(UnlinkSource);
