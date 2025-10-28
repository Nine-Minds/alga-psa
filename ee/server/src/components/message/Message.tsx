'use client';

import ReactMarkdown from "react-markdown"
import remarkGfm from 'remark-gfm'
import Image from 'next/image';
import Feedback from "../feedback/Feedback";
import './message.css';


type MessageProps = {
  messageId?: string,
  role: string;
  content: string;
  clientUrl?: string;
  isFunction?: boolean;
}

export const Message: React.FC<MessageProps> = (
  {
    messageId,
    role,
    content,
    clientUrl,
    isFunction
  }
) => {

  const transformMessage = (content: any) => {
    let msg = content;
    if (msg == null) {
      return "";
    }

    msg = msg.replace(/\[CONTEXT\][\s\S]*?\[\/CONTEXT\]/g, "")
    msg = msg.replace(/\[INST\]|\[\/INST\]/g, "").replace("<|end_of_text|><s>", "")
    msg = msg.replace(/%link_to_ticket\("(\d+)"\)%/g, (match: any, g1: any) => `[Ticket ${g1}](${clientUrl?.replace("ticket_id", g1)})`)
    msg = msg.replace(/###[\s\S]*?\[\/CONTEXT\]/g, ""); // Remove anything between ### and [/CONTEXT]
    msg = msg.replace("<|end_of_text|>", ""); // Remove <|end_of_text|> tags

    return msg;
  }

  return (
    <div>
      <div className={"chat-block"}>
        {role === "bot" && <Image className="chat-img" src={"/avatar-white.png"} alt="alga logo" width={18} height={18} />}

        <div className={`chat ${role === "bot" ? 'bot' : role === "notice" ? "bg-red-200" : " "
          }`}>
          {isFunction && <div className="shapes"></div>}

          <div className="chat-message-content"><ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              a: ({ node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" />
            }}
          >
            {
              transformMessage(content)
            }
          </ReactMarkdown></div>
        </div>
      </div>

      {messageId &&
        <Feedback
          messageId={messageId}
          role={role}
        />
      }
    </div>
  )
}

export default Message;
