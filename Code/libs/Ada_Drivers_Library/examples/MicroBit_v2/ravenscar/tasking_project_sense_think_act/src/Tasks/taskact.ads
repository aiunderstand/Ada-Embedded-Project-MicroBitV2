with MyMotorDriver; use MyMotorDriver;

package TaskAct is

   task Act with Priority=> 3;

   procedure Setup;    
   procedure Drive (direction : Directions);
   procedure DriveWheel(w : Wheel);
end TaskAct;
