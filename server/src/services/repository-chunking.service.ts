export interface SourceChunk {
  content: string;
  chunkIndex: number;
  startLine: number;
  endLine: number;
}

export function chunkSource(
  content: string,
  maxCharacters: number,
  overlapCharacters = Math.min(200, Math.floor(maxCharacters / 10)),
): SourceChunk[] {
  if (!Number.isInteger(maxCharacters) || maxCharacters < 1) throw new RangeError('Chunk size must be positive');
  if (!Number.isInteger(overlapCharacters) || overlapCharacters < 0 || overlapCharacters >= maxCharacters) {
    throw new RangeError('Chunk overlap must be smaller than the chunk size');
  }

  const characters = Array.from(content);
  const chunks: SourceChunk[] = [];
  let offset = 0;
  let chunkIndex = 0;

  while (offset < characters.length) {
    let end = Math.min(offset + maxCharacters, characters.length);
    if (end < characters.length) {
      const lineBreak = characters.lastIndexOf('\n', end - 1);
      if (lineBreak > offset) end = lineBreak + 1;
    }
    if (end <= offset) end = Math.min(offset + maxCharacters, characters.length);

    const startLine = characters.slice(0, offset).filter((character) => character === '\n').length + 1;
    const endLine = startLine + characters.slice(offset, end).filter((character) => character === '\n').length;
    chunks.push({ content: characters.slice(offset, end).join(''), chunkIndex, startLine, endLine });
    if (end === characters.length) break;
    offset = Math.max(offset + 1, end - overlapCharacters);
    chunkIndex += 1;
  }

  return chunks;
}
