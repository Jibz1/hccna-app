import { Schema } from "effect";
import { Image } from "expo-image";
import { Fragment, useState, type ReactNode } from "react";
import { Linking, View } from "react-native";

import { Text, type TextProps } from "@/ui/Text";

type RichAttrs = { readonly [key: string]: Schema.Json };
type RichMark = { readonly type: string; readonly attrs?: RichAttrs };
type RichNode = {
  readonly type: string;
  readonly text?: string;
  readonly attrs?: RichAttrs;
  readonly marks?: readonly RichMark[];
  readonly content?: readonly RichNode[];
};

const Attrs = Schema.optionalKey(Schema.Record(Schema.String, Schema.Json));
const RichMarkSchema = Schema.Struct({ type: Schema.String, attrs: Attrs });
const RichNodeSchema: Schema.Codec<RichNode> = Schema.Struct({
  type: Schema.String,
  text: Schema.optionalKey(Schema.String),
  attrs: Attrs,
  marks: Schema.optionalKey(Schema.Array(RichMarkSchema)),
  content: Schema.optionalKey(
    Schema.Array(Schema.suspend((): Schema.Codec<RichNode> => RichNodeSchema)),
  ),
});

/**
 * `Campus.content` and `Event.content`: the CMS body as the Tiptap document the server builds
 * (the same tree the website renders). Decode it where the query result arrives.
 */
export const RichDocument = Schema.Struct({
  type: Schema.Literal("doc"),
  content: Schema.Array(RichNodeSchema),
});
export type RichDocument = typeof RichDocument.Type;

interface RichTextStyle {
  readonly color: TextProps["color"];
  readonly comfortable: boolean;
}

const isNumber = Schema.is(Schema.Number);
const isString = Schema.is(Schema.String);

const bodyVariant = (style: RichTextStyle, bold: boolean) => {
  if (style.comfortable) {
    return bold ? "pSm/bold" : "pSm/regular";
  }
  return bold ? "labelXs/bold" : "labelXs/regular";
};

/** http(s), mailto and tel links only; anything else is shown as plain text. */
const safeLink = (href: Schema.Json | undefined) => {
  const url = isString(href) ? href.trim() : "";
  return /^(https?:\/\/|mailto:|tel:)/iu.test(url) ? url : undefined;
};

const safeImage = (src: Schema.Json | undefined) => {
  const url = isString(src) ? src.trim() : "";
  return /^https?:\/\//iu.test(url) ? url : undefined;
};

const openLink = (url: string) => {
  Linking.openURL(url).catch((error: Error) => {
    console.error("Failed to open URL:", error);
  });
};

const markClass = (type: string) => {
  switch (type) {
    case "italic": {
      return "italic";
    }
    case "underline": {
      return "underline";
    }
    case "strike": {
      return "line-through";
    }
    case "code": {
      return "font-mono";
    }
    case "highlight": {
      return "bg-design-selected";
    }
    default: {
      return undefined;
    }
  }
};

function TextRun({ node, style }: { node: RichNode; style: RichTextStyle }) {
  const marks = node.marks ?? [];
  const href = safeLink(
    marks.find((mark) => mark.type === "link")?.attrs?.["href"],
  );
  const bold = marks.some((mark) => mark.type === "bold");
  const className = marks
    .flatMap((mark) => markClass(mark.type) ?? [])
    .join(" ");
  return (
    <Text
      variant={bodyVariant(style, bold)}
      color={style.color}
      className={className === "" ? undefined : className}
      underline={href === undefined ? undefined : true}
      onPress={
        href === undefined
          ? undefined
          : () => {
              openLink(href);
            }
      }
    >
      {node.text ?? ""}
    </Text>
  );
}

const renderInline = (
  node: RichNode,
  key: string,
  style: RichTextStyle,
): ReactNode => {
  if (node.type === "text") {
    return <TextRun key={key} node={node} style={style} />;
  }
  if (node.type === "hardBreak") {
    return <Fragment key={key}>{"\n"}</Fragment>;
  }
  return (
    <Fragment key={key}>
      {(node.content ?? []).map((child, index) =>
        renderInline(child, `${key}-${index}`, style),
      )}
    </Fragment>
  );
};

const inlineChildren = (node: RichNode, key: string, style: RichTextStyle) =>
  (node.content ?? []).map((child, index) =>
    renderInline(child, `${key}-${index}`, style),
  );

const blockChildren = (node: RichNode, key: string, style: RichTextStyle) =>
  (node.content ?? []).map((child, index) =>
    renderBlock(child, `${key}-${index}`, style),
  );

function FigureImage({ uri, alt }: { uri: string; alt: string }) {
  const [aspectRatio, setAspectRatio] = useState(16 / 9);
  return (
    <Image
      source={{ uri }}
      accessibilityLabel={alt}
      contentFit="contain"
      cachePolicy="disk"
      style={{ width: "100%", aspectRatio }}
      onLoad={(event) => {
        if (event.source.height > 0) {
          setAspectRatio(event.source.width / event.source.height);
        }
      }}
    />
  );
}

const listMarker = (list: RichNode, index: number, item: RichNode) => {
  if (list.type === "taskList") {
    return item.attrs?.["checked"] === true ? "☑" : "☐";
  }
  if (list.type === "orderedList") {
    const start = list.attrs?.["start"];
    return `${(isNumber(start) ? start : 1) + index}.`;
  }
  return "•";
};

const renderList = (list: RichNode, key: string, style: RichTextStyle) => (
  <View key={key} className="gap-6xs">
    {(list.content ?? []).map((item, index) => (
      <View key={`${key}-${index}`} className="gap-5xs flex-row">
        <Text variant={bodyVariant(style, false)} color={style.color}>
          {listMarker(list, index, item)}
        </Text>
        <View className="gap-6xs min-w-0 flex-1">
          {blockChildren(item, `${key}-${index}`, style)}
        </View>
      </View>
    ))}
  </View>
);

function renderBlock(
  node: RichNode,
  key: string,
  style: RichTextStyle,
): ReactNode {
  switch (node.type) {
    case "paragraph": {
      if ((node.content ?? []).length === 0) {
        return null;
      }
      return (
        <Text
          key={key}
          variant={bodyVariant(style, false)}
          color={style.color}
          className={style.comfortable ? "w-full leading-[22px]" : "w-full"}
        >
          {inlineChildren(node, key, style)}
        </Text>
      );
    }
    case "text":
    case "hardBreak": {
      return (
        <Text key={key} variant={bodyVariant(style, false)} color={style.color}>
          {renderInline(node, key, style)}
        </Text>
      );
    }
    case "heading": {
      const level = node.attrs?.["level"];
      return (
        <Text
          key={key}
          accessibilityRole="header"
          variant={
            isNumber(level) && level <= 2 ? "headingSm/bold" : "headingXs/bold"
          }
          color={style.color}
          className="py-5xs"
        >
          {inlineChildren(node, key, style)}
        </Text>
      );
    }
    case "bulletList":
    case "orderedList":
    case "taskList": {
      return renderList(node, key, style);
    }
    case "blockquote": {
      return (
        <View
          key={key}
          className="border-design-border gap-5xs pl-4xs border-l-2"
        >
          {blockChildren(node, key, style)}
        </View>
      );
    }
    case "horizontalRule": {
      return <View key={key} className="bg-design-border my-5xs h-px w-full" />;
    }
    case "codeBlock": {
      return (
        <Text
          key={key}
          variant={bodyVariant(style, false)}
          color={style.color}
          className="font-mono"
        >
          {inlineChildren(node, key, style)}
        </Text>
      );
    }
    case "mediaFigure": {
      const uri = safeImage(node.attrs?.["src"]);
      const alt = node.attrs?.["alt"];
      return (
        <View key={key} className="gap-6xs w-full">
          {uri === undefined ? null : (
            <FigureImage uri={uri} alt={isString(alt) ? alt : ""} />
          )}
          {(node.content ?? []).length > 0 ? (
            <Text variant="labelXs/regular" color="designMuted" centered>
              {inlineChildren(node, key, style)}
            </Text>
          ) : null}
        </View>
      );
    }
    case "mediaEmbed": {
      const href = safeLink(node.attrs?.["source"]);
      return href === undefined ? null : (
        <Text
          key={key}
          variant={bodyVariant(style, false)}
          color={style.color}
          underline
          onPress={() => {
            openLink(href);
          }}
        >
          Watch the video
        </Text>
      );
    }
    case "attachment": {
      const href = safeLink(node.attrs?.["url"]);
      const title = node.attrs?.["title"];
      return href === undefined ? null : (
        <Text
          key={key}
          variant={bodyVariant(style, false)}
          color={style.color}
          underline
          onPress={() => {
            openLink(href);
          }}
        >
          {isString(title) && title !== "" ? title : "Download attachment"}
        </Text>
      );
    }
    case "table": {
      return (
        <View key={key} className="border-design-border w-full border">
          {(node.content ?? []).map((row, rowIndex) => (
            <View
              key={`${key}-${rowIndex}`}
              className="border-design-border flex-row border-b"
            >
              {(row.content ?? []).map((cell, cellIndex) => (
                <View
                  key={`${key}-${rowIndex}-${cellIndex}`}
                  className="border-design-border p-6xs flex-1 border-r"
                >
                  {blockChildren(cell, `${key}-${rowIndex}-${cellIndex}`, {
                    ...style,
                    comfortable: false,
                  })}
                </View>
              ))}
            </View>
          ))}
        </View>
      );
    }
    default: {
      // A node this build does not know yet: show what it contains.
      return <Fragment key={key}>{blockChildren(node, key, style)}</Fragment>;
    }
  }
}

export function RichText({
  content,
  color = "primary",
  comfortable = false,
}: {
  content: RichDocument;
  color?: TextProps["color"];
  comfortable?: boolean;
}) {
  const style = { color, comfortable };
  return (
    <View className={comfortable ? "gap-3xs" : "gap-5xs"}>
      {content.content.map((node, index) =>
        renderBlock(node, `${index}`, style),
      )}
    </View>
  );
}
