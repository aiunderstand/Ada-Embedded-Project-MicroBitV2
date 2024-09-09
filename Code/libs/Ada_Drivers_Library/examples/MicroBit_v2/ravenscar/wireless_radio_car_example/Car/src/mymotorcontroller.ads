with MicroBit.IOsForTasking; use MicroBit.IOsForTasking;

package MyMotorController is
  
      
   --define the types
   type DrivePins is record
         Forward : Pin_Id;
         Backward : Pin_Id;
         Speed : Pin_Id;  
   end record;
   
   type DriveParams is record
      Forward : Boolean;
      Backward : Boolean;
      Speed : Analog_Value; 
      Scale : Float;
   end record;
 
   type Wheel is record
      Pins : DrivePins;
      Params : DriveParams;
   end record;
   
   --define the procedures
   procedure Setup(LF : DrivePins;
                   LB : DrivePins;
                   RF : DrivePins;
                   RB : DrivePins);
  
   procedure Drive(LF : DriveParams;
                   LB : DriveParams;
                   RF : DriveParams;
                   RB : DriveParams);
   
   procedure DriveWheel(w : Wheel);
  
   procedure Stop;
   
   function Norm (Speed : Analog_Value; Scale : Float) return Analog_Value;
   
   UseCalibration : Boolean := True;
   
   private
   --define the private variables
   WheelLF : Wheel;
   WheelLB : Wheel;
   WheelRF : Wheel;
   WheelRB : Wheel;

end MyMotorController;
