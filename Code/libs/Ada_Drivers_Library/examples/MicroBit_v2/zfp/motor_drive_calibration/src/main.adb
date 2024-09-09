------------------------------------------------------------------------------
--                                                                          --
--                       Copyright (C) 2018, AdaCore                        --
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
with MicroBit;
with MicroBit.Time; use MicroBit.Time;
with MyMotorController; use MyMotorController;
with HAL; use Hal;

-- 2DO features:
-- Improve motor driver by using a MotorController.DriveFast procedure that directly set/clear pin registers
-- Add easing functionality to prevent slipping when changing wheel direction
-- Further improve calibration with more signals eg.
     -- Correlate speed with acceleromete/gyro/compass
     -- Add hardware wheel encoder to each wheel
     -- Use world pose system for external verification (eg. GPS, External camera beacons, OpenCV camera, etc)

procedure Main is
   --Calibation parameters
   DistanceTimeMs : constant UInt64 := 2000; -- 2 seconds is enough to determine if deviation is large or (very) small
   LoopCounter : Integer := 3; -- When individual runs give good results increase repetitions.
   UseCalibration : Boolean := True; -- Set to false to compare to a non calibrated version

   --Drive pattern parameters
   Forward : constant Boolean := True;
   Backward : constant Boolean := True;
   Left : constant Boolean := False;
   Right : constant Boolean := False;

   --Normalize
   normLF: Float := 1.0; -- set to 1.0 to negate this calibration effect, use small numbers around 1 like 0.95 or 1.10 . The normalize function will automatically round to integer and floor/ceil if needed
   normLB: Float := 1.0;
   normRF: Float := 1.0;
   normRB: Float := 1.0;
begin

   -- The mecanum car is using 2 motor drivers that control 4 DC motors without any rotary encoding and is therefore inaccurate.
   -- Each motor is slightly different leading to devatiation from the intended direction.
   -- We use a simple calibration routine to adjust the speed of each individual wheel that is unique to your car.
   -- Draw a large straight angled cross on a perfectly flat ground and place the car in the center.
   -- Do a calibration run, reposition the car in the center, adjust parameters and repeat.

   -- The motor driver code is simple, there is no "easing" like in a good motor driver.
   -- Easing, or ramp up and ramp down of the speed when changing directions prevents slipping of the wheels
   -- And thus greater traction.

   --************************************************************************
   -- A good calibration routine would be to:
   -- 0. Test if each wheel works individually with the Motor_Drive_Four_Wheels example
   -- 1. Calibrate. Find correct speed (PWM) values of each wheel for precise directions. Start with
   --       Forward := True and the other directions False and only 1 repetition;
   --       When good values found enable Backward and disble forward and try the mirrored values for the Backward direction
   --       Now enable both Forward and Backward and set repetitions to 3;
   --       Repeat for Left/Right with Forward/Backward disabled
   --       Repeat both now with all directions enabled. The car should return to the center.
   -- 2. Unit Normalize. Scale found speed values such that each direction is moving the same distance
   --       Take the direction that drives the car the shortest and increase the speed until it
   --       it matches the direction of the furthest. repeat for all directions
   --************************************************************************

   -- Setup motor pins for four individual wheel control
   MyMotorController.Setup(LF => (11,12,0),
                           LB => (13,14,1),
                           RF => (15,16,2),
                           RB => (19,20,3));

   -- Setup motor calibrated or uncalibrated motor control
   MyMotorController.UseCalibration := UseCalibration;

   loop
      --Control parameters for FORWARD
      if Forward = True then
         MyMotorController.Drive(LF => (True, False, 500, normLF),
                                 LB => (True, False, 500, normLF),
                                 RF => (True, False, 600, normLF),
                                 RB => (True, False, 600, normLF));

         Delay_Ms(DistanceTimeMs);
      end if;

      --Control parameters for BACKWARD
      if Backward = True then
         MyMotorController.Drive(LF => (False, True, 500, normLB),
                                 LB => (False, True, 500, normLB),
                                 RF => (False, True, 600, normLB),
                                 RB => (False, True, 600, normLB));

         Delay_Ms(DistanceTimeMs);
      end if;

      --Control parameters for LEFT
      if Left = True then
         MyMotorController.Drive(LF => (False, True,  600, normRF), -- same direction
                                 LB => (True,  False, 600, normRF),
                                 RF => (True,  False, 500, normRF),
                                 RB => (False, True,  500, normRF)); -- same direction

         Delay_Ms(DistanceTimeMs);
      end if;

      --Control parameters for RIGHT
      if Right = True then
         MyMotorController.Drive(LF => (True,  False, 600, normRB),  -- same direction
                                 LB => (False, True,  600, normRB),
                                 RF => (False, True,  500, normRB),
                                 RB => (True,  False, 500, normRB)); -- same direction

         Delay_Ms(DistanceTimeMs);
      end if;

      --Decrease loopcounter
      LoopCounter := LoopCounter -1;

      --Test if calibration run is done
      if LoopCounter <= 0 then -- stop and stay here forever
         loop
            MyMotorController.Stop;
         end loop;
      end if;

   end loop;
end Main;
