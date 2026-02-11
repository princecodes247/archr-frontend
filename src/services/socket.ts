import { io, Socket } from 'socket.io-client';

let socket: Socket;

export const initiateSocket = (url: string) => {
  socket = io(url);
  console.log('Connecting to socket...', url);
};

export const getSocket = () => {
  return socket;
};
