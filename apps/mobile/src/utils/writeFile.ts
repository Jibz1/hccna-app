import { File, Paths } from "expo-file-system";

export async function writeFile(filename: string, contents: string) {
  // const fileUri = FileSystem.documentDirectory! + filename;
  // await FileSystem.writeAsStringAsync(fileUri, contents, {
  //   encoding: FileSystem.EncodingType.UTF8,
  // });
  // return fileUri;
  try {
    const file = new File(Paths.cache, filename);
    file.create();
    await file.write(contents);
    return file.uri;
  } catch (error) {
    console.error(error);
    throw error;
  }
}
