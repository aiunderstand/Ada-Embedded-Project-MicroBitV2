with Ada.Real_Time; use Ada.Real_Time;
with MicroBit.Console; use MicroBit.Console;
package body MyController_empty is

   task body sense is
      myClock : Time;
   begin
      loop
         myClock := Clock;
         
         delay (0.05); --simulate 50 ms execution time, replace with your code
         
         MotorDriver.SetDirection (Stop);
         
         delay until myClock + Milliseconds(100);
      end loop;
   end sense;

      task body think is
      myClock : Time;
   begin
      loop
         myClock := Clock;
         
         delay (0.05); --simulate 50 ms execution time, replace with your code
         
         MotorDriver.SetDirection (Forward);
         
         delay until myClock + Milliseconds(100);
      end loop;
   end think;
   
      task body act is
      myClock : Time;
   begin
      loop
         myClock := Clock;
       
         Put_Line ("Direction is: " & Directions'Image (MotorDriver.GetDirection));
         
         delay until myClock + Milliseconds(40);
      end loop;
   end act;
   
    protected body MotorDriver is
      --  procedures can modify the data
      procedure SetDirection (V : Directions) is
      begin
         DriveDirection := V;
      end SetDirection;

      --  functions cannot modify the data
      function GetDirection return Directions is
      begin
         return DriveDirection;
      end GetDirection;
    end MotorDriver;
end MyController_empty;
