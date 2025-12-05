import React, { useState, useEffect } from 'react';
import { updateMessageAction } from '../../lib/chat-actions/chatActions';
import Image from 'next/image';
import { X } from 'lucide-react';
import './feedback.css';

type FeedbackProps = {
  messageId: string,
  role: string;
}

const Feedback: React.FC<FeedbackProps> = ({ messageId, role }) => {

  const [thumbStatus, setThumbStatus] = useState<string | null>(null); // 'up', 'down', or null
  const [feedbackInput, setFeedbackInput] = useState<string | null>(null);
  const [isFeedbackInputOpen, setIsFeedbackInputOpen] = useState(false);

  const [isAlertOpen, setIsAlertOpen] = useState(false);
  const [alertMessage, setAlertMessage] = useState("");

  useEffect(() => {
    let timeoutId: number;

    // Close the alert after 5 seconds
    if (isAlertOpen) {
      timeoutId = window.setTimeout(() => {
        handleAlertClose();
      }, 5000);
    }

    // Cleanup
    return () => {
      if (isAlertOpen)
        clearTimeout(timeoutId);
    }
  }, [isAlertOpen])

  // Update thumb and feedback in database
  const updateFeedback = async (thumbNew: string|null|undefined, feedbackNew: string|null|undefined) => {
    if (messageId) {
      try {
        const res = updateMessageAction(messageId, { thumb: thumbNew, feedback: feedbackNew });
        return res;
      } catch (error) {
        console.log("Error submitting feedback", error);
        setThumbStatus(null);
      }
    }
  }

  // When thumb up is clicked, store in database
  const handleThumbUpClick = async () => {
    // If click same thumb again, remove thumb
    if (thumbStatus === "up") {
      const response = await updateFeedback(null, null);
      if (response === 'success') {
        setThumbStatus(null);
      }
    }
    // Add thumb up to database
    else {
      const response = await updateFeedback("up", null);
      if (response === 'success') {
        setThumbStatus("up");
      }
    }
  }

  // When thumb down is clicked, store in database
  const handleThumbDownClick = async () => {
    // If click same thumb again, remove thumb
    if (thumbStatus === "down") {
      const response = await updateFeedback(null, null);
      if (response === 'success') {
        setThumbStatus(null);
      }
    }
    // Add thumb down to database
    else {
      const response = await updateFeedback("down", null);
      if (response === 'success') {
        setThumbStatus("down");
        setIsFeedbackInputOpen(true);
      }
    }
  }

  // Send feedback to database
  const handleSendFeedback = async () => {
    // If feedback is not empty, send to database
    if (feedbackInput !== null && feedbackInput !== "") {
      const response = await updateFeedback("down", feedbackInput.trim());
      if (response === 'success') {
        handleFeedbackInputClose();

        setAlertMessage("Thank you for your feedback. Your message has been sent.");
        setIsAlertOpen(true);
      }
      else {
        setAlertMessage("Error sending feedback. Please try again.");
        setIsAlertOpen(true);
      }
    }
  }

  // Save the text that the user types in the feedback input
  const handleFeedbackInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setFeedbackInput(e.target.value);
  }

  // Close feedback input
  const handleFeedbackInputClose = () => {
    setIsFeedbackInputOpen(false);
    setFeedbackInput(null);
  }

  // Close the alert
  const handleAlertClose = () => {
    setIsAlertOpen(false);
    setAlertMessage("");
  }

  return (
    <>
      {/* Alert for feedback */}
      {isAlertOpen && <div className="alert-popup" role="alert">
        <div className="alert-container">
          <p className="alert-text">{alertMessage}</p>
          <button className="alert-close" onClick={handleAlertClose}>
            <X size={16} />
          </button>
        </div>
      </div>}

      {role === "bot" &&
        <div className="feedback-container">
          <div className="thumbs-container">
            {/* Thumb up */}
            {thumbStatus === "up" ?
              <Image src="/thumb-up-fill.svg" alt="thumb up" className="thumb thumb-clicked" width={16} height={16} onClick={handleThumbUpClick} /> :
              <Image src="/thumb-up-outline.svg" alt="thumb up" className="thumb" width={16} height={16} onClick={handleThumbUpClick} />
            }

            {/* Thumb down */}
            {thumbStatus === "down" ?
              <Image src="/thumb-down-fill.svg" alt="thumb down" className="thumb thumb-clicked" width={16} height={16} onClick={handleThumbDownClick} /> :
              <Image src="/thumb-down-outline.svg" alt="thumb down" className="thumb" width={16} height={16} onClick={handleThumbDownClick} />
            }

            {/* If thumb down is clicked, open for feedback */}
          </div>
          {thumbStatus === "down" && isFeedbackInputOpen &&
            <div className="feedback-input-container">
              <textarea
                onChange={handleFeedbackInputChange}
                placeholder="Please provide feedback"
                className="feedback-input"
                rows={4}
                maxLength={500}
              />

              <div className="feedback-btn-container">
                <button className="feedback-btn feedback-btn-cancel" onClick={handleFeedbackInputClose}>Cancel</button>         {/* Close the feedback input but keep the thumb down */}
                <button className="feedback-btn feedback-btn-send" onClick={handleSendFeedback}>Send</button>
              </div>
            </div>}
        </div>}
    </>
  )
}

export default Feedback
