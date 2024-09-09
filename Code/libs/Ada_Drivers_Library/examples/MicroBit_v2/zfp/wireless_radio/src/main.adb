------------------------------------------------------------------------------
--                                                                          --
--                       Copyright (C) 2021, AdaCore                        --
--                                                                          --
--  Redistribution and use in source and binary forms, with or without      --
--  modification, are permitted provided that the following conditions are  --
--  met:                                                                    --
--     1. Redistributions of source code must retain the above copyright    --
--        notice, this list of conditions and the following disclaimer.     --
--     2. Redistributions in binary form must reproduce the above copyright --
--        notice, this list of conditions and the following disclaimer in   --
--        the documentation and/or other materials provided with the        --
--        distribution.                                                     --
--     3. Neither the name of the copyright holder nor the names of its     --
--        contributors may be used to endorse or promote products derived   --
--        from this software without specific prior written permission.     --
--                                                                          --
--   THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS    --
--   "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT      --
--   LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR  --
--   A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT   --
--   HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, --
--   SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT       --
--   LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,  --
--   DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY  --
--   THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT    --
--   (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE  --
--   OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.   --
--                                                                          --
------------------------------------------------------------------------------
with MicroBit.Radio; use MicroBit.Radio;
with HAL; use HAL;
with MicroBit.Console; use MicroBit.Console;
with MicroBit.Display;
with MicroBit.Display.Symbols;
with MicroBit.Time; use MicroBit.Time;

use MicroBit;
procedure Main is
   RXdata : RadioData;
   TxData : RadioData;
begin
   TxData.Length := 5;
   TxData.Version:= 12;
   TxData.Group := 1;
   TxData.Protocol := 14;

   Radio.Setup(RadioFrequency => 2407,
               Length => TxData.Length,
               Version => TxData.Version,
               Group => TxData.Group,
               Protocol => TxData.Protocol);

   Radio.StartReceiving;
   Put_Line(Radio.State); -- this should report Status: 3, meaning in RX mode

   loop
      --check if some data received and if so print it. Note that the framebuffer can max contain x messages (currently set to 4).
	  --important! Sometimes data received contains junk since we dont do any package verification and radio transmission is noisy!
      while Radio.DataReady loop
         RXdata :=Radio.Receive;
         Put("ZFP Received D1: " & UInt8'Image(RXdata.Payload(1)));
         Put_Line(" D2: " & UInt8'Image(RXdata.Payload(2)));
      end loop;

      -- setup some data to be transmitted and transmit it
      TxData.Payload(1) := 80;
      TxData.Payload(2) := 14;
      Put("Transmit D1: " & UInt8'Image(TXdata.Payload(1)));
      Put_Line(" D2: " & UInt8'Image(TXdata.Payload(2)));
      Radio.Transmit(TXdata);

      --repeat every 500 ms
      Delay_Ms(500);
   end loop;
end Main;
