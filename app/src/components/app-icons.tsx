import {
  BookMarked as BookMarkedSource,
  FileArchive as FileArchiveSource,
  FilePlus as FilePlusSource,
  File as FileSource,
  FileText as FileTextSource,
  FolderPlus as FolderPlusSource,
  Folder as FolderSource,
  FolderUp as FolderUpSource,
  KeyRound as KeyRoundSource,
  Layers as LayersSource,
  Lock as LockSource,
  Plug as PlugSource,
  Save as SaveSource,
  Split as SplitSource,
} from 'lucide-react';
import { icon } from '@/components/ui/icons';

/** The glyphs this app needs that the cubeui icon set (`ui/icons`) does not ship. */
export const BookMarked = icon(BookMarkedSource);
export const File = icon(FileSource);
export const FileArchive = icon(FileArchiveSource);
export const FilePlus = icon(FilePlusSource);
export const FileText = icon(FileTextSource);
export const Folder = icon(FolderSource);
export const FolderPlus = icon(FolderPlusSource);
export const FolderUp = icon(FolderUpSource);
export const KeyRound = icon(KeyRoundSource);
export const Layers = icon(LayersSource);
export const Lock = icon(LockSource);
export const Plug = icon(PlugSource);
export const Save = icon(SaveSource);
export const Split = icon(SplitSource);
