------------------------------------------------------------------------------
--                                                                          --
--                       Copyright (C) 2019, AdaCore                        --
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

with MicroBit.DisplayRT;
with MicroBit.DisplayRT.Symbols;
with MicroBit.DisplayRT;
with MicroBit.DisplayRT.Symbols;
with MicroBit.Console; use MicroBit.Console;
with MicroBit.Music; use MicroBit.Music;
with MicroBit.Radio; use MicroBit.Radio;
use MicroBit;
with MicroBit.Accelerometer;
with LSM303AGR; use LSM303AGR;
with Ada.Real_Time; use Ada.Real_Time;
with HAL; use HAL;
procedure Main is

   My_Little_Melody2 : constant MicroBit.Music.Melody :=
   ((C4,   400),
    (D4,   400),
    (E4,   400),
    (Rest, 400),
    (D4,   400),
    (E4,   400),
    (D4,   400),
    (F4,   400));

   RXdata : Radio.RadioData;
   X,Y,Z : Axis_Data;
   Threshold : constant := 150;
begin
   Put_Line (""); --send empty message since Ada runtime sends a zero symbol on the serial at bootup.
   --Send reset signal to unity
   Put_Line ("RST");

   MicroBit.DisplayRT.Symbols.Smile; -- show smile symbol on LEDs

   Radio.Setup(RadioFrequency => 2407,
               Length => 3+12,
               Version => 12,
               Group => 1,
               Protocol => 14);

   Radio.StartReceiving;
   Put_Line(Radio.State); -- this should report Status: 3, meaning in RX mode

   --Play(27,My_Little_Melody2); --startup sound

   loop

      while Radio.DataReady loop
         RXdata :=Radio.Receive;

         --check if message is reset message
         if RXdata.Payload(1) = 16#FF# and RXdata.Payload(2) = 16#FF# then
            Put_Line ("RST");
         else
            Put_Line(  "MSG;" &
            RXdata.Payload(1)'Image  & ";" &
            RXdata.Payload(2)'Image  & ";" &
            RXdata.Payload(3)'Image  & ";" &
            RXdata.Payload(4)'Image  & ";" &
            RXdata.Payload(5)'Image  & ";" &
            RXdata.Payload(6)'Image  & ";" &
            RXdata.Payload(7)'Image  & ";" &
            RXdata.Payload(8)'Image  & ";" &
            RXdata.Payload(9)'Image  & ";" &
            RXdata.Payload(10)'Image & ";" &
            RXdata.Payload(11)'Image & ";" &
            RXdata.Payload(12)'Image);

            --copy LED output indicate it is RXing
            X:= LSM303AGR.Convert(RXdata.Payload(1), RXdata.Payload(2)) * Axis_Data (-1);
            Y:= LSM303AGR.Convert(RXdata.Payload(3), RXdata.Payload(4));
            Z:= LSM303AGR.Convert(RXdata.Payload(5), RXdata.Payload(6));

             --  Clear the LED matrix
            MicroBit.DisplayRT.Clear;

            if X > Threshold then
               MicroBit.DisplayRT.Symbols.Left_Arrow;

            elsif X < -Threshold then
               MicroBit.DisplayRT.Symbols.Right_Arrow;

            elsif Y > Threshold then
               DisplayRT.Symbols.Up_Arrow;

            elsif Y < -Threshold then
               MicroBit.DisplayRT.Symbols.Down_Arrow;

            else
               MicroBit.DisplayRT.Symbols.Heart;
            end if;

         end if;
         end loop;

      --  Do nothing for 100 milliseconds
       delay until Clock + Milliseconds(100);
   end loop;
end Main;
