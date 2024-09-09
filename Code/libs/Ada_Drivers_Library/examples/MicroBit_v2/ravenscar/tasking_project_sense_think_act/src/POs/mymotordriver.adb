package body MyMotorDriver is

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

      procedure SetMotorPins (V : MotorControllerPins) is
      begin
         Pins := V;
      end SetMotorPins;

      --  functions cannot modify the data
      function GetMotorPins return MotorControllerPins is
      begin
         return Pins;
      end GetMotorPins;
      
   end MotorDriver;

end MyMotorDriver;
