use std::io::{self, ErrorKind};
use std::pin::Pin;
use std::sync::Arc;
use std::task::{Context, Poll};

use tokio::io::AsyncWrite;
use tokio::sync::mpsc;
use wasmtime_wasi::cli::{IsTerminal, StdoutStream};

/// A stdout stream that forwards every write to the supplied callback.
pub struct StderrPipe {
    sender: mpsc::UnboundedSender<Vec<u8>>,
}

impl StderrPipe {
    /// Create a new pipe that calls `callback` for each batch of bytes written.
    pub fn new<F>(callback: F) -> Self
    where
        F: Fn(Vec<u8>) + Send + Sync + 'static,
    {
        let (sender, mut receiver) = mpsc::unbounded_channel();
        let callback = Arc::new(callback);
        tokio::spawn(async move {
            while let Some(bytes) = receiver.recv().await {
                (callback)(bytes);
            }
        });
        Self { sender }
    }
}

impl IsTerminal for StderrPipe {
    fn is_terminal(&self) -> bool {
        false
    }
}

impl StdoutStream for StderrPipe {
    fn async_stream(&self) -> Box<dyn AsyncWrite + Send + Sync> {
        Box::new(StderrWriter {
            sender: self.sender.clone(),
        })
    }
}

struct StderrWriter {
    sender: mpsc::UnboundedSender<Vec<u8>>,
}

impl AsyncWrite for StderrWriter {
    fn poll_write(
        self: Pin<&mut Self>,
        _cx: &mut Context<'_>,
        buf: &[u8],
    ) -> Poll<io::Result<usize>> {
        let me = self.get_mut();
        let bytes = buf.to_vec();
        let len = bytes.len();
        match me.sender.send(bytes) {
            Ok(()) => Poll::Ready(Ok(len)),
            Err(_) => Poll::Ready(Err(io::Error::new(
                ErrorKind::BrokenPipe,
                "stderr receiver dropped",
            ))),
        }
    }

    fn poll_flush(self: Pin<&mut Self>, _cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        Poll::Ready(Ok(()))
    }

    fn poll_shutdown(self: Pin<&mut Self>, _cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        Poll::Ready(Ok(()))
    }
}
