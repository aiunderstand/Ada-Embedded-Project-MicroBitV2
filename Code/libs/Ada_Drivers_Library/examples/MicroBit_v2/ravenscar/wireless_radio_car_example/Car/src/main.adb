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

with MicroBit.Music; use MicroBit.Music;
with MicroBit.Radio; use MicroBit.Radio;
use MicroBit;
with MicroBit.Accelerometer;
with MicroBit.Console; use MicroBit.Console;
with LSM303AGR; use LSM303AGR;
with HAL; use HAL;
with ada.Real_Time; use ada.Real_Time;
with MyMotorController; use MyMotorController;
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

   --Calibation parameters
   UseCalibration : Boolean := True; -- Set to false to compare to a non calibrated version

   --Normalize
   normLF: Float := 1.0; -- set to 1.0 to negate this calibration effect, use small numbers around 1 like 0.95 or 1.10 . The normalize function will automatically round to integer and floor/ceil if needed
   normLB: Float := 1.0;
   normRF: Float := 1.0;
   normRB: Float := 1.0;
   myClock: Time;
   
begin
   
   Radio.Setup(RadioFrequency => 2407,
               Length => 3+12,
               Version => 12,
               Group => 1,
               Protocol => 14);

   Radio.StartReceiving;
   Put_Line(Radio.State); -- this should report Status: 3, meaning in RX mode

   Play(27,My_Little_Melody2); --startup sound

    -- Setup motor pins for four individual wheel control
   MyMotorController.Setup(LF => (11,12,0),
                           LB => (13,14,1),
                           RF => (15,16,2),
                           RB => (19,10,3));

   -- Setup motor calibrated or uncalibrated motor control
   MyMotorController.UseCalibration := UseCalibration;

   loop
      myclock := Clock;
        
      while Radio.DataReady loop
         RXdata :=Radio.Receive;

            --copy LED output indicate it is RXing
            X:= LSM303AGR.Convert(RXdata.Payload(1), RXdata.Payload(2)) * Axis_Data (-1);
            Y:= LSM303AGR.Convert(RXdata.Payload(3), RXdata.Payload(4));
            Z:= LSM303AGR.Convert(RXdata.Payload(5), RXdata.Payload(6));

            if X > Threshold then
               --left
               MyMotorController.Drive(LF => (False, True,  900, normRF), -- same direction
                                 LB => (True,  False, 600, normRF),
                                 RF => (True,  False, 500, normRF),
                                 RB => (False, True,  900, normRF)); -- same direction

            elsif X < -Threshold then
               --right
                MyMotorController.Drive(LF => (True,  False, 900, normRB),  -- same direction
                                 LB => (False, True,  600, normRB),
                                 RF => (False, True,  500, normRB),
                                 RB => (True,  False, 900, normRB)); -- same direction

            elsif Y > Threshold then
               --backward
                MyMotorController.Drive(LF => (True, False, 900, normLF),
                                 LB => (True, False, 500, normLF),
                                 RF => (True, False, 600, normLF),
                                        RB => (True, False, 900, normLF));


            elsif Y < -Threshold then
               --forward
               MyMotorController.Drive(LF => (False, True, 900, normLB),
                                 LB => (False, True, 500, normLB),
                                 RF => (False, True, 600, normLB),
                                 RB => (False, True, 900, normLB));

            else
               --stop
                MyMotorController.Stop;

            end if;       
         end loop;
		 
      delay until myclock + Milliseconds(50);

   end loop;
end Main;
